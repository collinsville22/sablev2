/// BTCVault Stablecoin Vault — USDC Lending on Vesu RE7 USDC Core
///
/// ERC-4626 vault: deposit USDC → Vesu RE7_USDC_CORE pool → earn supply APY.
/// No debt, no swap, no leverage. Same pattern as Sentinel but for USDC.

#[starknet::contract]
pub mod StablecoinVault {
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use starknet::ClassHash;
    use starknet::SyscallResultTrait;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess, StorageMapReadAccess, StorageMapWriteAccess};
    use core::num::traits::Zero;

    use btcvault::interfaces::{
        IERC20Dispatcher, IERC20DispatcherTrait,
        IVesuPoolDispatcher, IVesuPoolDispatcherTrait,
        ModifyPositionParams, Amount, AmountDenomination, i257,
    };

    // ── Storage ─────────────────────────────────────────────────────────

    #[storage]
    struct Storage {
        // ERC20 core
        name: ByteArray,
        symbol: ByteArray,
        total_supply: u256,
        balances: starknet::storage::Map<ContractAddress, u256>,
        allowances: starknet::storage::Map<(ContractAddress, ContractAddress), u256>,
        // ERC4626 core
        asset: ContractAddress,
        total_assets_managed: u256,
        // Vault management
        owner: ContractAddress,
        pending_owner: ContractAddress,
        // Strategy config — Vesu only
        vesu_singleton: ContractAddress,
        vesu_pool_id: felt252,
        debt_asset: ContractAddress,
        // Strategy state
        total_collateral_deposited: u256,
        is_paused: bool,
    }

    // ── Events ──────────────────────────────────────────────────────────

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Transfer: Transfer,
        Approval: Approval,
        Deposit: DepositEvent,
        Withdraw: WithdrawEvent,
        StrategyDeposit: StrategyDeposit,
        StrategyWithdraw: StrategyWithdraw,
        OwnershipTransferred: OwnershipTransferred,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Transfer {
        #[key]
        pub from: ContractAddress,
        #[key]
        pub to: ContractAddress,
        pub value: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Approval {
        #[key]
        pub owner: ContractAddress,
        #[key]
        pub spender: ContractAddress,
        pub value: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct DepositEvent {
        #[key]
        pub sender: ContractAddress,
        #[key]
        pub owner: ContractAddress,
        pub assets: u256,
        pub shares: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct WithdrawEvent {
        #[key]
        pub sender: ContractAddress,
        #[key]
        pub receiver: ContractAddress,
        #[key]
        pub owner: ContractAddress,
        pub assets: u256,
        pub shares: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct StrategyDeposit {
        pub amount: u256,
        pub pool_id: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct StrategyWithdraw {
        pub amount: u256,
        pub pool_id: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OwnershipTransferred {
        pub previous_owner: ContractAddress,
        pub new_owner: ContractAddress,
    }

    // ── Constructor ─────────────────────────────────────────────────────

    #[constructor]
    fn constructor(
        ref self: ContractState,
        asset: ContractAddress,
        owner: ContractAddress,
        vesu_singleton: ContractAddress,
        vesu_pool_id: felt252,
    ) {
        self.name.write("BTCVault Stablecoin");
        self.symbol.write("yvUSDC-STAB");
        self.asset.write(asset);
        self.owner.write(owner);
        self.vesu_singleton.write(vesu_singleton);
        self.vesu_pool_id.write(vesu_pool_id);
        self.total_supply.write(0);
        self.total_assets_managed.write(0);
        self.total_collateral_deposited.write(0);
        self.is_paused.write(false);

        self.emit(OwnershipTransferred {
            previous_owner: Zero::zero(),
            new_owner: owner,
        });
    }

    // ── ERC20 Implementation ────────────────────────────────────────────

    #[abi(embed_v0)]
    impl ERC20Impl of btcvault::interfaces::IERC20<ContractState> {
        fn name(self: @ContractState) -> ByteArray { self.name.read() }
        fn symbol(self: @ContractState) -> ByteArray { self.symbol.read() }
        fn decimals(self: @ContractState) -> u8 { 6_u8 }
        fn total_supply(self: @ContractState) -> u256 { self.total_supply.read() }
        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 { self.balances.read(account) }
        fn allowance(self: @ContractState, owner: ContractAddress, spender: ContractAddress) -> u256 { self.allowances.read((owner, spender)) }

        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            let sender = get_caller_address();
            self._transfer(sender, recipient, amount);
            true
        }

        fn transfer_from(ref self: ContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256) -> bool {
            let caller = get_caller_address();
            let current_allowance = self.allowances.read((sender, caller));
            assert(current_allowance >= amount, 'ERC20: insufficient allowance');
            self.allowances.write((sender, caller), current_allowance - amount);
            self._transfer(sender, recipient, amount);
            true
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            let owner = get_caller_address();
            self.allowances.write((owner, spender), amount);
            self.emit(Approval { owner, spender, value: amount });
            true
        }
    }

    // ── ERC4626 Implementation ──────────────────────────────────────────

    #[abi(embed_v0)]
    impl ERC4626Impl of btcvault::interfaces::IERC4626<ContractState> {
        fn asset(self: @ContractState) -> ContractAddress { self.asset.read() }
        fn total_assets(self: @ContractState) -> u256 { self.total_assets_managed.read() }

        fn convert_to_shares(self: @ContractState, assets: u256) -> u256 {
            let supply = self.total_supply.read();
            let total = self.total_assets_managed.read();
            if supply == 0 || total == 0 { assets } else { (assets * supply) / total }
        }

        fn convert_to_assets(self: @ContractState, shares: u256) -> u256 {
            let supply = self.total_supply.read();
            let total = self.total_assets_managed.read();
            if supply == 0 { shares } else { (shares * total) / supply }
        }

        fn max_deposit(self: @ContractState, receiver: ContractAddress) -> u256 {
            let _ = receiver;
            if self.is_paused.read() { 0 } else { 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff_u256 }
        }

        fn preview_deposit(self: @ContractState, assets: u256) -> u256 { self.convert_to_shares(assets) }

        fn deposit(ref self: ContractState, assets: u256, receiver: ContractAddress) -> u256 {
            assert(!self.is_paused.read(), 'Vault: paused');
            assert(assets > 0, 'Vault: zero assets');
            let shares = self.convert_to_shares(assets);
            assert(shares > 0, 'Vault: zero shares');
            let caller = get_caller_address();
            let this = get_contract_address();
            let usdc = IERC20Dispatcher { contract_address: self.asset.read() };
            usdc.transfer_from(caller, this, assets);
            self._mint(receiver, shares);
            self.total_assets_managed.write(self.total_assets_managed.read() + assets);
            self.emit(DepositEvent { sender: caller, owner: receiver, assets, shares });
            self._deploy_to_strategy(assets);
            shares
        }

        fn max_mint(self: @ContractState, receiver: ContractAddress) -> u256 {
            let _ = receiver;
            if self.is_paused.read() { 0 } else { 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff_u256 }
        }

        fn preview_mint(self: @ContractState, shares: u256) -> u256 { self.convert_to_assets(shares) }

        fn mint(ref self: ContractState, shares: u256, receiver: ContractAddress) -> u256 {
            assert(!self.is_paused.read(), 'Vault: paused');
            let assets = self.convert_to_assets(shares);
            assert(assets > 0, 'Vault: zero assets');
            let caller = get_caller_address();
            let this = get_contract_address();
            let usdc = IERC20Dispatcher { contract_address: self.asset.read() };
            usdc.transfer_from(caller, this, assets);
            self._mint(receiver, shares);
            self.total_assets_managed.write(self.total_assets_managed.read() + assets);
            self.emit(DepositEvent { sender: caller, owner: receiver, assets, shares });
            self._deploy_to_strategy(assets);
            assets
        }

        fn max_withdraw(self: @ContractState, owner: ContractAddress) -> u256 { self.convert_to_assets(self.balances.read(owner)) }
        fn preview_withdraw(self: @ContractState, assets: u256) -> u256 { self.convert_to_shares(assets) }

        fn withdraw(ref self: ContractState, assets: u256, receiver: ContractAddress, owner: ContractAddress) -> u256 {
            self._refresh_total_assets();
            assert(assets > 0, 'Vault: zero assets');
            let shares = self.convert_to_shares(assets);
            assert(shares > 0, 'Vault: zero shares');
            let caller = get_caller_address();
            if caller != owner {
                let a = self.allowances.read((owner, caller));
                assert(a >= shares, 'Vault: insufficient allowance');
            }

            self._ensure_idle_balance(assets);

            let usdc = IERC20Dispatcher { contract_address: self.asset.read() };
            let actual_balance = usdc.balance_of(get_contract_address());
            let transfer_amount = if actual_balance < assets { actual_balance } else { assets };

            let owner_balance = self.balances.read(owner);
            let final_shares = if shares >= owner_balance {
                owner_balance
            } else if transfer_amount < assets && assets > 0 {
                let proportional = (shares * transfer_amount) / assets;
                if proportional == 0 && transfer_amount > 0 { 1_u256 } else { proportional }
            } else { shares };
            assert(final_shares > 0, 'Vault: nothing redeemable');

            if caller != owner {
                let a = self.allowances.read((owner, caller));
                self.allowances.write((owner, caller), a - final_shares);
            }
            self._burn(owner, final_shares);

            let current_managed = self.total_assets_managed.read();
            if transfer_amount <= current_managed {
                self.total_assets_managed.write(current_managed - transfer_amount);
            } else {
                self.total_assets_managed.write(0);
            }
            usdc.transfer(receiver, transfer_amount);
            self.emit(WithdrawEvent { sender: caller, receiver, owner, assets: transfer_amount, shares: final_shares });
            final_shares
        }

        fn max_redeem(self: @ContractState, owner: ContractAddress) -> u256 { self.balances.read(owner) }
        fn preview_redeem(self: @ContractState, shares: u256) -> u256 { self.convert_to_assets(shares) }

        fn redeem(ref self: ContractState, shares: u256, receiver: ContractAddress, owner: ContractAddress) -> u256 {
            self._refresh_total_assets();
            assert(shares > 0, 'Vault: zero shares');
            let caller = get_caller_address();
            if caller != owner {
                let a = self.allowances.read((owner, caller));
                assert(a >= shares, 'Vault: insufficient allowance');
            }
            let assets = self.convert_to_assets(shares);
            if assets == 0 {
                let owner_balance = self.balances.read(owner);
                let to_burn = if shares > owner_balance { owner_balance } else { shares };
                if caller != owner {
                    let a = self.allowances.read((owner, caller));
                    self.allowances.write((owner, caller), a - to_burn);
                }
                self._burn(owner, to_burn);
                self.emit(WithdrawEvent { sender: caller, receiver, owner, assets: 0, shares: to_burn });
                return 0;
            }

            self._ensure_idle_balance(assets);

            let usdc = IERC20Dispatcher { contract_address: self.asset.read() };
            let actual_balance = usdc.balance_of(get_contract_address());
            let transfer_amount = if actual_balance < assets { actual_balance } else { assets };

            let owner_balance = self.balances.read(owner);
            let final_shares = if shares >= owner_balance {
                owner_balance
            } else if transfer_amount < assets && assets > 0 {
                let proportional = (shares * transfer_amount) / assets;
                if proportional == 0 && transfer_amount > 0 { 1_u256 } else { proportional }
            } else { shares };
            assert(final_shares > 0, 'Vault: nothing redeemable');

            if caller != owner {
                let a = self.allowances.read((owner, caller));
                self.allowances.write((owner, caller), a - final_shares);
            }
            self._burn(owner, final_shares);

            let current_managed = self.total_assets_managed.read();
            if transfer_amount <= current_managed {
                self.total_assets_managed.write(current_managed - transfer_amount);
            } else {
                self.total_assets_managed.write(0);
            }
            usdc.transfer(receiver, transfer_amount);
            self.emit(WithdrawEvent { sender: caller, receiver, owner, assets: transfer_amount, shares: final_shares });
            transfer_amount
        }
    }

    // ── Curator Functions (Vesu only) ───────────────────────────────────

    #[abi(embed_v0)]
    impl CuratorImpl of super::IStablecoinCurator<ContractState> {
        fn deploy_to_vesu(ref self: ContractState, amount: u256) {
            self._assert_owner();
            assert(amount > 0, 'Vault: zero amount');
            let this = get_contract_address();
            let usdc_addr = self.asset.read();
            let pool_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: pool_addr };
            let usdc = IERC20Dispatcher { contract_address: usdc_addr };
            usdc.approve(pool_addr, amount);

            let params = ModifyPositionParams {
                collateral_asset: usdc_addr,
                debt_asset: self.debt_asset.read(),
                user: this,
                collateral: Amount {
                    denomination: AmountDenomination::Assets,
                    value: i257 { abs: amount, is_negative: false },
                },
                debt: Amount {
                    denomination: AmountDenomination::Assets,
                    value: i257 { abs: 0, is_negative: false },
                },
            };

            vesu.modify_position(params);
            self.total_collateral_deposited.write(self.total_collateral_deposited.read() + amount);
            self.emit(StrategyDeposit { amount, pool_id: self.vesu_pool_id.read() });
        }

        fn withdraw_from_vesu(ref self: ContractState, amount: u256) {
            self._assert_owner();
            assert(amount > 0, 'Vault: zero amount');
            let this = get_contract_address();
            let usdc_addr = self.asset.read();
            let pool_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: pool_addr };

            let params = ModifyPositionParams {
                collateral_asset: usdc_addr,
                debt_asset: self.debt_asset.read(),
                user: this,
                collateral: Amount {
                    denomination: AmountDenomination::Assets,
                    value: i257 { abs: amount, is_negative: true },
                },
                debt: Amount {
                    denomination: AmountDenomination::Assets,
                    value: i257 { abs: 0, is_negative: false },
                },
            };

            vesu.modify_position(params);
            let prev = self.total_collateral_deposited.read();
            if amount <= prev { self.total_collateral_deposited.write(prev - amount); }
            else { self.total_collateral_deposited.write(0); }
            self.emit(StrategyWithdraw { amount, pool_id: self.vesu_pool_id.read() });
        }

        fn harvest(ref self: ContractState) {
            self._assert_owner();
            self._refresh_total_assets();
        }

        fn upgrade(ref self: ContractState, new_class_hash: ClassHash) {
            self._assert_owner();
            starknet::syscalls::replace_class_syscall(new_class_hash).unwrap_syscall();
        }

        fn set_debt_asset(ref self: ContractState, debt_asset: ContractAddress) {
            self._assert_owner();
            self.debt_asset.write(debt_asset);
        }

        fn set_vesu_pool_id(ref self: ContractState, pool_id: felt252) {
            self._assert_owner();
            self.vesu_pool_id.write(pool_id);
        }

        fn pause(ref self: ContractState) { self._assert_owner(); self.is_paused.write(true); }
        fn unpause(ref self: ContractState) { self._assert_owner(); self.is_paused.write(false); }

        fn transfer_ownership(ref self: ContractState, new_owner: ContractAddress) {
            self._assert_owner();
            self.pending_owner.write(new_owner);
        }

        fn accept_ownership(ref self: ContractState) {
            let caller = get_caller_address();
            assert(caller == self.pending_owner.read(), 'Not pending owner');
            let prev = self.owner.read();
            self.owner.write(caller);
            self.pending_owner.write(Zero::zero());
            self.emit(OwnershipTransferred { previous_owner: prev, new_owner: caller });
        }
    }

    // ── View Functions ──────────────────────────────────────────────────

    #[abi(embed_v0)]
    impl VaultViewImpl of super::IStablecoinView<ContractState> {
        fn get_owner(self: @ContractState) -> ContractAddress { self.owner.read() }

        fn get_strategy_info(self: @ContractState) -> (u256, u256, u8, bool) {
            (self.total_collateral_deposited.read(), 0, 0, self.is_paused.read())
        }

        fn get_vesu_pool_id(self: @ContractState) -> felt252 { self.vesu_pool_id.read() }

        fn get_debt_asset(self: @ContractState) -> ContractAddress { self.debt_asset.read() }

        fn min_deposit(self: @ContractState) -> u256 {
            let usdc_addr = self.asset.read();
            let pool_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: pool_addr };
            let config = vesu.asset_config(usdc_addr);
            let asset_price = vesu.price(usdc_addr);
            if asset_price.value > 0 && config.floor > 0 {
                (config.floor * config.scale) / asset_price.value + 1
            } else {
                0
            }
        }
    }

    // ── Internal Helpers ────────────────────────────────────────────────

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _assert_owner(self: @ContractState) {
            assert(get_caller_address() == self.owner.read(), 'Caller is not owner');
        }

        fn _refresh_total_assets(ref self: ContractState) {
            let this = get_contract_address();
            let usdc_addr = self.asset.read();
            let pool_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: pool_addr };
            let (_position, collateral_value, _debt_value) = vesu.position(usdc_addr, self.debt_asset.read(), this);
            let usdc = IERC20Dispatcher { contract_address: usdc_addr };
            let idle = usdc.balance_of(this);
            self.total_assets_managed.write(collateral_value + idle);
            self.total_collateral_deposited.write(collateral_value);
        }

        fn _mint(ref self: ContractState, to: ContractAddress, amount: u256) {
            self.total_supply.write(self.total_supply.read() + amount);
            self.balances.write(to, self.balances.read(to) + amount);
            self.emit(Transfer { from: Zero::zero(), to, value: amount });
        }

        fn _burn(ref self: ContractState, from: ContractAddress, amount: u256) {
            let balance = self.balances.read(from);
            assert(balance >= amount, 'ERC20: insufficient balance');
            self.balances.write(from, balance - amount);
            self.total_supply.write(self.total_supply.read() - amount);
            self.emit(Transfer { from, to: Zero::zero(), value: amount });
        }

        fn _transfer(ref self: ContractState, from: ContractAddress, to: ContractAddress, amount: u256) {
            let from_balance = self.balances.read(from);
            assert(from_balance >= amount, 'ERC20: insufficient balance');
            self.balances.write(from, from_balance - amount);
            self.balances.write(to, self.balances.read(to) + amount);
            self.emit(Transfer { from, to, value: amount });
        }

        fn _deploy_to_strategy(ref self: ContractState, amount: u256) {
            let this = get_contract_address();
            let usdc_addr = self.asset.read();
            let pool_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: pool_addr };

            // Query Vesu dust threshold dynamically: min_amount = floor * scale / price
            let config = vesu.asset_config(usdc_addr);
            let asset_price = vesu.price(usdc_addr);
            if asset_price.value > 0 && config.floor > 0 {
                let min_amount = (config.floor * config.scale) / asset_price.value + 1;
                if amount < min_amount { return; }
            }

            let usdc = IERC20Dispatcher { contract_address: usdc_addr };
            usdc.approve(pool_addr, amount);

            let params = ModifyPositionParams {
                collateral_asset: usdc_addr,
                debt_asset: self.debt_asset.read(),
                user: this,
                collateral: Amount {
                    denomination: AmountDenomination::Assets,
                    value: i257 { abs: amount, is_negative: false },
                },
                debt: Amount {
                    denomination: AmountDenomination::Assets,
                    value: i257 { abs: 0, is_negative: false },
                },
            };

            vesu.modify_position(params);
            self.total_collateral_deposited.write(self.total_collateral_deposited.read() + amount);
            self.emit(StrategyDeposit { amount, pool_id: self.vesu_pool_id.read() });
        }

        fn _ensure_idle_balance(ref self: ContractState, needed: u256) {
            let this = get_contract_address();
            let usdc_addr = self.asset.read();
            let usdc = IERC20Dispatcher { contract_address: usdc_addr };
            let idle = usdc.balance_of(this);
            if idle >= needed { return; }
            let deficit = needed - idle;
            let pool_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: pool_addr };

            let (_pos, collateral_val, _) = vesu.position(usdc_addr, self.debt_asset.read(), this);
            if collateral_val == 0 { return; }

            let mut to_withdraw = if deficit < collateral_val { deficit } else { collateral_val };

            // If remaining would be below Vesu dust threshold, withdraw ALL
            if to_withdraw < collateral_val {
                let config = vesu.asset_config(usdc_addr);
                let asset_price = vesu.price(usdc_addr);
                if asset_price.value > 0 && config.floor > 0 {
                    let min_amount = (config.floor * config.scale) / asset_price.value + 1;
                    if (collateral_val - to_withdraw) < min_amount {
                        to_withdraw = collateral_val;
                    }
                }
            }

            vesu.modify_position(ModifyPositionParams {
                collateral_asset: usdc_addr,
                debt_asset: self.debt_asset.read(),
                user: this,
                collateral: Amount {
                    denomination: AmountDenomination::Assets,
                    value: i257 { abs: to_withdraw, is_negative: true },
                },
                debt: Amount {
                    denomination: AmountDenomination::Assets,
                    value: i257 { abs: 0, is_negative: false },
                },
            });
            let prev = self.total_collateral_deposited.read();
            if to_withdraw <= prev { self.total_collateral_deposited.write(prev - to_withdraw); }
            else { self.total_collateral_deposited.write(0); }
            self.emit(StrategyWithdraw { amount: to_withdraw, pool_id: self.vesu_pool_id.read() });
        }
    }
}

// ── External Trait Definitions ──────────────────────────────────────────

#[starknet::interface]
pub trait IStablecoinCurator<TContractState> {
    fn deploy_to_vesu(ref self: TContractState, amount: u256);
    fn withdraw_from_vesu(ref self: TContractState, amount: u256);
    fn harvest(ref self: TContractState);
    fn upgrade(ref self: TContractState, new_class_hash: starknet::ClassHash);
    fn set_debt_asset(ref self: TContractState, debt_asset: starknet::ContractAddress);
    fn set_vesu_pool_id(ref self: TContractState, pool_id: felt252);
    fn pause(ref self: TContractState);
    fn unpause(ref self: TContractState);
    fn transfer_ownership(ref self: TContractState, new_owner: starknet::ContractAddress);
    fn accept_ownership(ref self: TContractState);
}

#[starknet::interface]
pub trait IStablecoinView<TContractState> {
    fn get_owner(self: @TContractState) -> starknet::ContractAddress;
    fn get_strategy_info(self: @TContractState) -> (u256, u256, u8, bool);
    fn get_vesu_pool_id(self: @TContractState) -> felt252;
    fn get_debt_asset(self: @TContractState) -> starknet::ContractAddress;
    fn min_deposit(self: @TContractState) -> u256;
}
