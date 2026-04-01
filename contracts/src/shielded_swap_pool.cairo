/// BTCVault Shielded Swap Pool — Private Token Swaps via Pool-to-Pool Transfer
///
/// Enables private swaps from WBTC shielded pools to output tokens (ETH/USDC/STRK).
/// Reuses the same V4 Groth16 circuit — no new circuit or trusted setup needed.
///
/// Flow:
///   1. private_swap() — Relayer withdraws WBTC from a V4 pool (proof has recipient=this),
///      swaps WBTC→output_token via AVNU, inserts new commitment into Merkle tree.
///      Each deposit is a "batch of 1" for V4 circuit compatibility.
///   2. withdraw() — User proves batch membership (batchStart=leafIndex, batchSize=1),
///      receives output token at a fresh address.

#[starknet::contract]
pub mod ShieldedSwapPool {
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use starknet::ClassHash;
    use starknet::SyscallResultTrait;
    use starknet::storage::{
        StoragePointerReadAccess, StoragePointerWriteAccess,
        StorageMapReadAccess, StorageMapWriteAccess,
    };
    use core::num::traits::Zero;

    // BN254 Poseidon hash from garaga — matches circomlib Poseidon(2)
    use garaga::hashes::poseidon_bn254::poseidon_hash_2;

    use btcvault::interfaces::{
        IERC20Dispatcher, IERC20DispatcherTrait,
        IGroth16VerifierDispatcher, IGroth16VerifierDispatcherTrait,
        IAvnuExchangeDispatcher, IAvnuExchangeDispatcherTrait,
        Route,
    };

    use btcvault::strategy::addresses::AVNU_EXCHANGE;

    /// BN254 Poseidon hash of two u256 field elements.
    fn bn254_hash_pair(left: u256, right: u256) -> u256 {
        poseidon_hash_2(left, right)
    }

    // Merkle tree depth: 2^10 = 1,024 max deposits
    const TREE_DEPTH: u32 = 10;
    // Ring buffer of recent roots
    const ROOT_HISTORY_SIZE: u32 = 30;

    // ── Storage ──────────────────────────────────────────────────────

    #[storage]
    struct Storage {
        // Merkle tree state (same as V4)
        next_index: u32,
        filled_subtrees: starknet::storage::Map<u32, u256>,
        roots: starknet::storage::Map<u32, u256>,
        current_root_index: u32,

        // Double-spend prevention (same as V4)
        commitments: starknet::storage::Map<u256, bool>,
        nullifier_hashes: starknet::storage::Map<u256, bool>,

        // Per-leaf token holding (replaces V4's batch/vault system)
        leaf_amount: starknet::storage::Map<u32, u256>,
        leaf_token: starknet::storage::Map<u32, ContractAddress>,

        // External contracts
        wbtc: ContractAddress,
        verifier: ContractAddress,      // Garaga Groth16 BN254 verifier (7 public inputs)

        // Management
        owner: ContractAddress,
        is_paused: bool,
        max_fee_bps: u32,              // Max relayer fee in basis points

        // Accounting
        active_deposits: u32,
        total_swaps: u32,
    }

    // ── Events ───────────────────────────────────────────────────────

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        SwapDeposit: SwapDepositEvent,
        SwapWithdraw: SwapWithdrawEvent,
    }

    #[derive(Drop, starknet::Event)]
    pub struct SwapDepositEvent {
        #[key]
        pub commitment: u256,
        pub leaf_index: u32,
        pub output_token: ContractAddress,
        pub output_amount: u256,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct SwapWithdrawEvent {
        #[key]
        pub nullifier_hash: u256,
        pub recipient: ContractAddress,
        pub output_token: ContractAddress,
        pub payout: u256,
        pub fee: u256,
    }

    // ── Constructor ──────────────────────────────────────────────────

    #[constructor]
    fn constructor(
        ref self: ContractState,
        wbtc: ContractAddress,
        verifier: ContractAddress,
        owner: ContractAddress,
    ) {
        self.wbtc.write(wbtc);
        self.verifier.write(verifier);
        self.owner.write(owner);
        self.max_fee_bps.write(500); // Default 5% max fee
        self.is_paused.write(false);
        self.next_index.write(0);
        self.current_root_index.write(0);
        self.active_deposits.write(0);
        self.total_swaps.write(0);

        // Initialize Merkle tree with zero values
        let mut current_zero: u256 = 0;
        let mut i: u32 = 0;
        while i < TREE_DEPTH {
            self.filled_subtrees.write(i, current_zero);
            current_zero = bn254_hash_pair(current_zero, current_zero);
            i += 1;
        };
        self.roots.write(0, current_zero);
    }

    // ── External Functions ───────────────────────────────────────────

    #[abi(embed_v0)]
    impl ShieldedSwapPoolImpl of super::IShieldedSwapPool<ContractState> {
        /// Execute a private swap: withdraw WBTC from V4 pool → swap to output token → store
        ///
        /// The proof_calldata contains a V4 withdrawal proof where recipient = this contract.
        /// WBTC arrives here atomically, gets swapped to output_token via AVNU,
        /// and a new commitment is inserted into this pool's Merkle tree.
        fn private_swap(
            ref self: ContractState,
            wbtc_pool: ContractAddress,
            proof_calldata: Span<felt252>,
            new_commitment: u256,
            output_token: ContractAddress,
            min_amount_out: u256,
            routes: Array<Route>,
        ) {
            self._assert_owner();
            assert(!self.is_paused.read(), 'SwapPool: paused');
            assert(!self.commitments.read(new_commitment), 'SwapPool: commitment exists');

            let this = get_contract_address();
            let wbtc_addr = self.wbtc.read();
            let wbtc_token = IERC20Dispatcher { contract_address: wbtc_addr };

            // 1. Record WBTC balance before V4 withdrawal
            let wbtc_before = wbtc_token.balance_of(this);

            // 2. Call V4 pool's withdraw() — proof has recipient = this contract
            //    V4's withdraw is permissionless: verifies proof, redeems vault shares,
            //    sends WBTC to the proof's recipient address
            let mut calldata = array![];
            let mut i: u32 = 0;
            while i < proof_calldata.len() {
                calldata.append(*proof_calldata.at(i));
                i += 1;
            };
            starknet::syscalls::call_contract_syscall(
                wbtc_pool,
                selector!("withdraw"),
                calldata.span(),
            ).unwrap_syscall();

            // 3. Measure WBTC received
            let wbtc_after = wbtc_token.balance_of(this);
            let wbtc_received = wbtc_after - wbtc_before;
            assert(wbtc_received > 0, 'SwapPool: no WBTC received');

            // 4. Swap WBTC → output_token via AVNU
            let avnu_addr: ContractAddress = AVNU_EXCHANGE.try_into().unwrap();
            wbtc_token.approve(avnu_addr, wbtc_received);

            let output_erc20 = IERC20Dispatcher { contract_address: output_token };
            let output_before = output_erc20.balance_of(this);

            let avnu = IAvnuExchangeDispatcher { contract_address: avnu_addr };
            avnu.multi_route_swap(
                wbtc_addr,          // token_from: WBTC
                wbtc_received,      // amount: all received WBTC
                output_token,       // token_to: output token
                0,                  // token_to_amount: not used
                min_amount_out,     // min output: slippage protection
                this,               // beneficiary: this contract
                0,                  // integrator_fee: 0
                Zero::zero(),       // fee_recipient: none
                routes,             // routes from relayer
            );

            // 5. Measure output token received
            let output_after = output_erc20.balance_of(this);
            let output_received = output_after - output_before;
            assert(output_received > 0, 'SwapPool: no output received');

            // 6. Insert commitment into Merkle tree
            let leaf_index = self._insert(new_commitment);
            self.commitments.write(new_commitment, true);

            // 7. Store per-leaf amount and token
            self.leaf_amount.write(leaf_index, output_received);
            self.leaf_token.write(leaf_index, output_token);

            // 8. Update accounting
            self.active_deposits.write(self.active_deposits.read() + 1);
            self.total_swaps.write(self.total_swaps.read() + 1);

            let block_info = starknet::get_block_info().unbox();
            self.emit(SwapDepositEvent {
                commitment: new_commitment,
                leaf_index,
                output_token,
                output_amount: output_received,
                timestamp: block_info.block_timestamp,
            });
        }

        /// Withdraw output token using a Groth16 ZK proof.
        /// Proof public inputs: [root, nullifierHash, recipient, relayer, fee, batchStart, batchSize]
        /// batchSize MUST be 1 (each swap deposit is a single leaf).
        fn withdraw(ref self: ContractState, proof_with_hints: Span<felt252>) {
            assert(!self.is_paused.read(), 'SwapPool: paused');

            // Verify Groth16 proof via Garaga
            let verifier = IGroth16VerifierDispatcher {
                contract_address: self.verifier.read()
            };
            let result = verifier.verify_groth16_proof_bn254(proof_with_hints);
            let public_inputs = match result {
                Result::Ok(inputs) => inputs,
                Result::Err(_) => { panic!("SwapPool: invalid proof"); },
            };

            // Parse 7 public inputs
            assert(public_inputs.len() >= 7, 'SwapPool: bad public inputs');
            let root: u256 = *public_inputs.at(0);
            let nullifier_hash: u256 = *public_inputs.at(1);
            let recipient_u256: u256 = *public_inputs.at(2);
            let relayer_u256: u256 = *public_inputs.at(3);
            let fee: u256 = *public_inputs.at(4);
            let batch_start_u256: u256 = *public_inputs.at(5);
            let batch_size_u256: u256 = *public_inputs.at(6);

            // Convert addresses
            let recipient_felt: felt252 = recipient_u256.try_into().expect('bad recipient');
            let recipient: ContractAddress = recipient_felt.try_into().expect('bad addr');
            let relayer_felt: felt252 = relayer_u256.try_into().expect('bad relayer');
            let relayer: ContractAddress = relayer_felt.try_into().expect('bad addr');

            // Convert batch params
            let batch_start_felt: felt252 = batch_start_u256.try_into().expect('bad batchStart');
            let batch_start_u64: u64 = batch_start_felt.try_into().expect('bad batchStart');
            let batch_start: u32 = batch_start_u64.try_into().expect('bad batchStart');

            let batch_size_felt: felt252 = batch_size_u256.try_into().expect('bad batchSize');
            let batch_size_u64: u64 = batch_size_felt.try_into().expect('bad batchSize');
            let batch_size: u32 = batch_size_u64.try_into().expect('bad batchSize');

            // Each swap deposit is a single leaf — batchSize must be 1
            assert(batch_size == 1, 'SwapPool: batchSize must be 1');

            // Verify nullifier hasn't been spent
            assert(!self.nullifier_hashes.read(nullifier_hash), 'SwapPool: already withdrawn');

            // Verify the Merkle root is known (recent)
            assert(self._is_known_root(root), 'SwapPool: unknown root');

            // Look up stored amount and token for this leaf
            let stored_amount = self.leaf_amount.read(batch_start);
            let stored_token = self.leaf_token.read(batch_start);
            assert(stored_amount > 0, 'SwapPool: empty leaf');

            // Verify fee doesn't exceed max_fee_bps of stored amount
            let max_fee = (stored_amount * self.max_fee_bps.read().into()) / 10000;
            assert(fee <= max_fee, 'SwapPool: fee too high');

            // Mark nullifier as spent
            self.nullifier_hashes.write(nullifier_hash, true);

            // Send (amount - fee) to recipient
            let token = IERC20Dispatcher { contract_address: stored_token };
            let recipient_amount = stored_amount - fee;
            token.transfer(recipient, recipient_amount);

            // Send fee to relayer
            if fee > 0 {
                token.transfer(relayer, fee);
            }

            // Decrement active deposits
            self.active_deposits.write(self.active_deposits.read() - 1);

            self.emit(SwapWithdrawEvent {
                nullifier_hash,
                recipient,
                output_token: stored_token,
                payout: recipient_amount,
                fee,
            });
        }

        // ── View Functions ───────────────────────────────────────────

        fn get_leaf_info(self: @ContractState, leaf_index: u32) -> (ContractAddress, u256) {
            (self.leaf_token.read(leaf_index), self.leaf_amount.read(leaf_index))
        }

        fn get_next_index(self: @ContractState) -> u32 {
            self.next_index.read()
        }

        fn is_spent(self: @ContractState, nullifier_hash: u256) -> bool {
            self.nullifier_hashes.read(nullifier_hash)
        }

        fn get_last_root(self: @ContractState) -> u256 {
            self.roots.read(self.current_root_index.read())
        }

        fn active_deposits(self: @ContractState) -> u32 {
            self.active_deposits.read()
        }

        fn total_swaps(self: @ContractState) -> u32 {
            self.total_swaps.read()
        }

        fn is_known_commitment(self: @ContractState, commitment: u256) -> bool {
            self.commitments.read(commitment)
        }

        fn max_fee_bps(self: @ContractState) -> u32 {
            self.max_fee_bps.read()
        }
    }

    // ── Curator Functions ────────────────────────────────────────────

    #[abi(embed_v0)]
    impl CuratorImpl of super::IShieldedSwapPoolCurator<ContractState> {
        fn pause(ref self: ContractState) {
            self._assert_owner();
            self.is_paused.write(true);
        }

        fn unpause(ref self: ContractState) {
            self._assert_owner();
            self.is_paused.write(false);
        }

        fn upgrade(ref self: ContractState, new_class_hash: ClassHash) {
            self._assert_owner();
            starknet::syscalls::replace_class_syscall(new_class_hash).unwrap_syscall();
        }

        fn set_verifier(ref self: ContractState, verifier: ContractAddress) {
            self._assert_owner();
            self.verifier.write(verifier);
        }

        fn set_max_fee_bps(ref self: ContractState, bps: u32) {
            self._assert_owner();
            assert(bps <= 1000, 'SwapPool: fee > 10%');
            self.max_fee_bps.write(bps);
        }

        fn emergency_withdraw(ref self: ContractState, token: ContractAddress, recipient: ContractAddress) {
            self._assert_owner();
            let this = get_contract_address();
            let erc20 = IERC20Dispatcher { contract_address: token };
            let balance = erc20.balance_of(this);
            if balance > 0 {
                erc20.transfer(recipient, balance);
            }
        }
    }

    // ── Internal Helpers (same as V4) ────────────────────────────────

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _assert_owner(self: @ContractState) {
            assert(get_caller_address() == self.owner.read(), 'Not owner');
        }

        /// Insert a leaf into the Merkle tree, returns the leaf index.
        fn _insert(ref self: ContractState, leaf: u256) -> u32 {
            let current_index = self.next_index.read();
            assert(current_index < 1024, 'SwapPool: tree full');

            let mut current_hash = leaf;
            let mut current_level_index = current_index;
            let mut i: u32 = 0;

            while i < TREE_DEPTH {
                if current_level_index % 2 == 0 {
                    self.filled_subtrees.write(i, current_hash);
                    let zero_hash = self._get_zero_value(i);
                    current_hash = bn254_hash_pair(current_hash, zero_hash);
                } else {
                    let left = self.filled_subtrees.read(i);
                    current_hash = bn254_hash_pair(left, current_hash);
                }
                current_level_index = current_level_index / 2;
                i += 1;
            };

            let new_root_index = (self.current_root_index.read() + 1) % ROOT_HISTORY_SIZE;
            self.roots.write(new_root_index, current_hash);
            self.current_root_index.write(new_root_index);

            let leaf_index = current_index;
            self.next_index.write(current_index + 1);
            leaf_index
        }

        fn _get_zero_value(self: @ContractState, level: u32) -> u256 {
            let mut current: u256 = 0;
            let mut i: u32 = 0;
            while i < level {
                current = bn254_hash_pair(current, current);
                i += 1;
            };
            current
        }

        fn _is_known_root(self: @ContractState, root: u256) -> bool {
            if root == 0 { return false; }
            let current = self.current_root_index.read();
            let mut i: u32 = 0;
            let mut found = false;
            while i < ROOT_HISTORY_SIZE {
                let idx = if current >= i {
                    current - i
                } else {
                    ROOT_HISTORY_SIZE - (i - current)
                };
                if self.roots.read(idx) == root {
                    found = true;
                    break;
                }
                i += 1;
            };
            found
        }
    }
}

// ── External Trait Definitions ───────────────────────────────────────────

use starknet::ContractAddress;
use btcvault::interfaces::Route;

#[starknet::interface]
pub trait IShieldedSwapPool<TContractState> {
    fn private_swap(
        ref self: TContractState,
        wbtc_pool: ContractAddress,
        proof_calldata: Span<felt252>,
        new_commitment: u256,
        output_token: ContractAddress,
        min_amount_out: u256,
        routes: Array<Route>,
    );
    fn withdraw(ref self: TContractState, proof_with_hints: Span<felt252>);
    fn get_leaf_info(self: @TContractState, leaf_index: u32) -> (ContractAddress, u256);
    fn get_next_index(self: @TContractState) -> u32;
    fn is_spent(self: @TContractState, nullifier_hash: u256) -> bool;
    fn get_last_root(self: @TContractState) -> u256;
    fn active_deposits(self: @TContractState) -> u32;
    fn total_swaps(self: @TContractState) -> u32;
    fn is_known_commitment(self: @TContractState, commitment: u256) -> bool;
    fn max_fee_bps(self: @TContractState) -> u32;
}

#[starknet::interface]
pub trait IShieldedSwapPoolCurator<TContractState> {
    fn pause(ref self: TContractState);
    fn unpause(ref self: TContractState);
    fn upgrade(ref self: TContractState, new_class_hash: starknet::ClassHash);
    fn set_verifier(ref self: TContractState, verifier: starknet::ContractAddress);
    fn set_max_fee_bps(ref self: TContractState, bps: u32);
    fn emergency_withdraw(ref self: TContractState, token: starknet::ContractAddress, recipient: starknet::ContractAddress);
}
