#[starknet::contract]
pub mod ShieldedPoolV5 {
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use starknet::ClassHash;
    use starknet::SyscallResultTrait;
    use starknet::storage::{
        StoragePointerReadAccess, StoragePointerWriteAccess,
        StorageMapReadAccess, StorageMapWriteAccess,
    };

    use garaga::hashes::poseidon_bn254::poseidon_hash_2;

    use btcvault::interfaces::{
        IERC20Dispatcher, IERC20DispatcherTrait,
        IERC4626Dispatcher, IERC4626DispatcherTrait,
        IGroth16VerifierDispatcher, IGroth16VerifierDispatcherTrait,
    };

    fn bn254_hash_pair(left: u256, right: u256) -> u256 {
        poseidon_hash_2(left, right)
    }

    const FIELD_SIZE: u256 = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    const TREE_DEPTH: u32 = 20;
    const MAX_TREE_SIZE: u32 = 1048576;

    const ROOT_HISTORY_SIZE: u32 = 30;

    const MAX_EXT_AMOUNT: u256 = 452312848583266388373324160190187140051835877600158453279131187530910662656;

    #[storage]
    struct Storage {
        next_index: u32,
        filled_subtrees: starknet::storage::Map<u32, u256>,
        roots: starknet::storage::Map<u32, u256>,
        current_root_index: u32,

        zero_values: starknet::storage::Map<u32, u256>,

        nullifier_hashes: starknet::storage::Map<u256, bool>,

        asset: ContractAddress,
        verifier: ContractAddress,
        vault: ContractAddress,

        max_deposit_amount: u256,
        min_deposit_amount: u256,

        total_vault_shares: u256,

        asp_root: u256,
        asp_enabled: bool,

        owner: ContractAddress,
        is_paused: bool,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        NewCommitment: NewCommitmentEvent,
        NewNullifier: NewNullifierEvent,
    }

    #[derive(Drop, starknet::Event)]
    pub struct NewCommitmentEvent {
        #[key]
        pub commitment: u256,
        pub leaf_index: u32,
        pub encrypted_output: Span<felt252>,
        pub ephemeral_pubkey: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct NewNullifierEvent {
        #[key]
        pub nullifier: u256,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        asset: ContractAddress,
        verifier: ContractAddress,
        vault: ContractAddress,
        owner: ContractAddress,
        max_deposit: u256,
        min_deposit: u256,
    ) {
        self.asset.write(asset);
        self.verifier.write(verifier);
        self.vault.write(vault);
        self.owner.write(owner);
        self.max_deposit_amount.write(max_deposit);
        self.min_deposit_amount.write(min_deposit);
        self.next_index.write(0);
        self.current_root_index.write(0);
        self.total_vault_shares.write(0);
        self.asp_root.write(0);
        self.asp_enabled.write(false);
        self.is_paused.write(false);

        let mut current_zero: u256 = 0;
        let mut i: u32 = 0;
        while i < TREE_DEPTH {
            self.zero_values.write(i, current_zero);
            self.filled_subtrees.write(i, current_zero);
            current_zero = bn254_hash_pair(current_zero, current_zero);
            i += 1;
        };
        self.zero_values.write(TREE_DEPTH, current_zero);
        self.roots.write(0, current_zero);
    }

    #[abi(embed_v0)]
    impl ShieldedPoolV5Impl of super::IShieldedPoolV5<ContractState> {
        fn transact(
            ref self: ContractState,
            proof_with_hints: Span<felt252>,
            depositor: ContractAddress,
            recipient: ContractAddress,
            relayer: ContractAddress,
            fee: u256,
            ext_amount: u256,
            ext_data_hash: u256,
            encrypted_output_0: Span<felt252>,
            encrypted_output_1: Span<felt252>,
            ephemeral_pubkey_0: u256,
            ephemeral_pubkey_1: u256,
        ) {
            assert(!self.is_paused.read(), 'Pool: paused');

            let verifier = IGroth16VerifierDispatcher {
                contract_address: self.verifier.read()
            };
            let result = verifier.verify_groth16_proof_bn254(proof_with_hints);
            let public_signals = match result {
                Result::Ok(inputs) => inputs,
                Result::Err(_) => { panic!("Pool: invalid proof"); },
            };

            assert(public_signals.len() >= 8, 'Pool: bad public signals');
            let in_nullifier_0: u256 = *public_signals.at(0);
            let in_nullifier_1: u256 = *public_signals.at(1);
            let out_commitment_0: u256 = *public_signals.at(2);
            let out_commitment_1: u256 = *public_signals.at(3);
            let proof_root: u256 = *public_signals.at(4);
            let proof_subset_root: u256 = *public_signals.at(5);
            let proof_public_amount: u256 = *public_signals.at(6);
            let proof_ext_data_hash: u256 = *public_signals.at(7);

            assert(proof_ext_data_hash == ext_data_hash, 'Pool: ext_data_hash mismatch');

            let expected_public_amount = self._calculate_public_amount(ext_amount, fee);
            assert(proof_public_amount == expected_public_amount, 'Pool: publicAmount mismatch');

            assert(self._is_known_root(proof_root), 'Pool: unknown root');

            if self.asp_enabled.read() {
                let asp_root = self.asp_root.read();
                assert(proof_subset_root == asp_root, 'Pool: bad ASP root');
            }

            assert(!self.nullifier_hashes.read(in_nullifier_0), 'Pool: nullifier 0 spent');
            assert(!self.nullifier_hashes.read(in_nullifier_1), 'Pool: nullifier 1 spent');
            assert(in_nullifier_0 != in_nullifier_1, 'Pool: duplicate nullifiers');

            self.nullifier_hashes.write(in_nullifier_0, true);
            self.nullifier_hashes.write(in_nullifier_1, true);

            let is_deposit = ext_amount > 0 && ext_amount < MAX_EXT_AMOUNT;
            let is_withdrawal = ext_amount > FIELD_SIZE - MAX_EXT_AMOUNT;

            if is_deposit {
                self._process_deposit(ext_amount, depositor);
            }

            if is_withdrawal {
                let withdraw_amount = FIELD_SIZE - ext_amount;
                self._process_withdrawal(withdraw_amount, recipient, fee, relayer);
            }

            let idx0 = self._insert(out_commitment_0);
            let idx1 = self._insert(out_commitment_1);

            self.emit(NewCommitmentEvent {
                commitment: out_commitment_0,
                leaf_index: idx0,
                encrypted_output: encrypted_output_0,
                ephemeral_pubkey: ephemeral_pubkey_0,
            });
            self.emit(NewCommitmentEvent {
                commitment: out_commitment_1,
                leaf_index: idx1,
                encrypted_output: encrypted_output_1,
                ephemeral_pubkey: ephemeral_pubkey_1,
            });
            self.emit(NewNullifierEvent { nullifier: in_nullifier_0 });
            self.emit(NewNullifierEvent { nullifier: in_nullifier_1 });
        }

        fn get_last_root(self: @ContractState) -> u256 {
            self.roots.read(self.current_root_index.read())
        }

        fn get_next_index(self: @ContractState) -> u32 {
            self.next_index.read()
        }

        fn is_spent(self: @ContractState, nullifier_hash: u256) -> bool {
            self.nullifier_hashes.read(nullifier_hash)
        }

        fn total_vault_shares(self: @ContractState) -> u256 {
            self.total_vault_shares.read()
        }

        fn total_pool_assets(self: @ContractState) -> u256 {
            self._total_pool_assets()
        }

        fn asp_root(self: @ContractState) -> u256 {
            self.asp_root.read()
        }

        fn is_asp_enabled(self: @ContractState) -> bool {
            self.asp_enabled.read()
        }

        fn max_deposit_amount(self: @ContractState) -> u256 {
            self.max_deposit_amount.read()
        }

        fn min_deposit_amount(self: @ContractState) -> u256 {
            self.min_deposit_amount.read()
        }
    }

    #[abi(embed_v0)]
    impl CuratorImpl of super::IShieldedPoolV5Curator<ContractState> {
        fn set_asp_root(ref self: ContractState, root: u256) {
            self._assert_owner();
            self.asp_root.write(root);
        }

        fn set_asp_enabled(ref self: ContractState, enabled: bool) {
            self._assert_owner();
            self.asp_enabled.write(enabled);
        }

        fn set_verifier(ref self: ContractState, verifier: ContractAddress) {
            self._assert_owner();
            self.verifier.write(verifier);
        }

        fn set_max_deposit(ref self: ContractState, amount: u256) {
            self._assert_owner();
            self.max_deposit_amount.write(amount);
        }

        fn set_min_deposit(ref self: ContractState, amount: u256) {
            self._assert_owner();
            self.min_deposit_amount.write(amount);
        }

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

        fn emergency_withdraw(ref self: ContractState, recipient: ContractAddress) {
            self._assert_owner();
            let this = get_contract_address();
            let wbtc = IERC20Dispatcher { contract_address: self.asset.read() };
            let vault_addr = self.vault.read();
            let vault = IERC4626Dispatcher { contract_address: vault_addr };
            let vault_erc20 = IERC20Dispatcher { contract_address: vault_addr };

            let vault_shares = vault_erc20.balance_of(this);
            if vault_shares > 0 {
                vault.redeem(vault_shares, this, this);
            }

            let wbtc_balance = wbtc.balance_of(this);
            if wbtc_balance > 0 {
                wbtc.transfer(recipient, wbtc_balance);
            }
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _assert_owner(self: @ContractState) {
            assert(get_caller_address() == self.owner.read(), 'Not owner');
        }

        fn _calculate_public_amount(self: @ContractState, ext_amount: u256, fee: u256) -> u256 {
            if ext_amount >= fee {
                ext_amount - fee
            } else {
                FIELD_SIZE - (fee - ext_amount)
            }
        }

        fn _process_deposit(ref self: ContractState, sats_amount: u256, depositor: ContractAddress) {
            assert(sats_amount >= self.min_deposit_amount.read(), 'Pool: below min deposit');
            assert(sats_amount <= self.max_deposit_amount.read(), 'Pool: exceeds max deposit');

            let this = get_contract_address();
            let wbtc = IERC20Dispatcher { contract_address: self.asset.read() };
            let vault = IERC4626Dispatcher { contract_address: self.vault.read() };

            wbtc.transfer_from(depositor, this, sats_amount);

            wbtc.approve(self.vault.read(), sats_amount);
            let shares = vault.deposit(sats_amount, this);
            self.total_vault_shares.write(self.total_vault_shares.read() + shares);
        }

        fn _process_withdrawal(
            ref self: ContractState,
            sats_amount: u256,
            recipient: ContractAddress,
            fee: u256,
            relayer: ContractAddress,
        ) {
            assert(recipient != starknet::contract_address_const::<0>(), 'Pool: zero recipient');

            let this = get_contract_address();
            let wbtc = IERC20Dispatcher { contract_address: self.asset.read() };
            let vault = IERC4626Dispatcher { contract_address: self.vault.read() };

            let total_needed = sats_amount + fee;
            let shares_needed = vault.convert_to_shares(total_needed);

            let wbtc_before = wbtc.balance_of(this);
            vault.redeem(shares_needed, this, this);
            let wbtc_after = wbtc.balance_of(this);
            let redeemed = wbtc_after - wbtc_before;

            self.total_vault_shares.write(self.total_vault_shares.read() - shares_needed);

            let payout = if redeemed >= total_needed {
                sats_amount
            } else if redeemed > fee {
                redeemed - fee
            } else {
                panic!("Pool: insufficient redeemed amount");
                0
            };
            wbtc.transfer(recipient, payout);

            if fee > 0 {
                wbtc.transfer(relayer, fee);
            }
        }

        fn _total_pool_assets(self: @ContractState) -> u256 {
            let this = get_contract_address();
            let vault_addr = self.vault.read();
            let vault = IERC4626Dispatcher { contract_address: vault_addr };
            let vault_as_erc20 = IERC20Dispatcher { contract_address: vault_addr };
            let wbtc = IERC20Dispatcher { contract_address: self.asset.read() };

            let our_shares = vault_as_erc20.balance_of(this);
            let vault_assets = if our_shares > 0 {
                vault.convert_to_assets(our_shares)
            } else {
                0
            };
            let idle = wbtc.balance_of(this);
            vault_assets + idle
        }

        fn _insert(ref self: ContractState, leaf: u256) -> u32 {
            let current_index = self.next_index.read();
            assert(current_index < MAX_TREE_SIZE, 'Pool: tree full');

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
            self.zero_values.read(level)
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

use starknet::ContractAddress;
use starknet::ClassHash;

#[starknet::interface]
pub trait IShieldedPoolV5<TContractState> {
    fn transact(
        ref self: TContractState,
        proof_with_hints: Span<felt252>,
        depositor: ContractAddress,
        recipient: ContractAddress,
        relayer: ContractAddress,
        fee: u256,
        ext_amount: u256,
        ext_data_hash: u256,
        encrypted_output_0: Span<felt252>,
        encrypted_output_1: Span<felt252>,
        ephemeral_pubkey_0: u256,
        ephemeral_pubkey_1: u256,
    );
    fn get_last_root(self: @TContractState) -> u256;
    fn get_next_index(self: @TContractState) -> u32;
    fn is_spent(self: @TContractState, nullifier_hash: u256) -> bool;
    fn total_vault_shares(self: @TContractState) -> u256;
    fn total_pool_assets(self: @TContractState) -> u256;
    fn asp_root(self: @TContractState) -> u256;
    fn is_asp_enabled(self: @TContractState) -> bool;
    fn max_deposit_amount(self: @TContractState) -> u256;
    fn min_deposit_amount(self: @TContractState) -> u256;
}

#[starknet::interface]
pub trait IShieldedPoolV5Curator<TContractState> {
    fn set_asp_root(ref self: TContractState, root: u256);
    fn set_asp_enabled(ref self: TContractState, enabled: bool);
    fn set_verifier(ref self: TContractState, verifier: ContractAddress);
    fn set_max_deposit(ref self: TContractState, amount: u256);
    fn set_min_deposit(ref self: TContractState, amount: u256);
    fn pause(ref self: TContractState);
    fn unpause(ref self: TContractState);
    fn upgrade(ref self: TContractState, new_class_hash: ClassHash);
    fn emergency_withdraw(ref self: TContractState, recipient: ContractAddress);
}
