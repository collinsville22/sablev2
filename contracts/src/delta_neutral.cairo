/// BTCVault Delta Neutral — USDC Yield Spread (Vesu dual-pool)
///
/// Supply WBTC → borrow USDC → deposit USDC to second Vesu pool.
/// Earn spread between USDC borrow cost and USDC yield. No AVNU needed.

#[starknet::contract]
pub mod BTCVaultDeltaNeutral {
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use starknet::ClassHash;
    use starknet::SyscallResultTrait;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess, StorageMapReadAccess, StorageMapWriteAccess};
    use core::num::traits::Zero;

    use btcvault::interfaces::{
        IERC20Dispatcher, IERC20DispatcherTrait,
        IVesuPoolDispatcher, IVesuPoolDispatcherTrait,
        IPragmaOracleDispatcher, IPragmaOracleDispatcherTrait,
        IAvnuExchangeDispatcher, IAvnuExchangeDispatcherTrait,
        ModifyPositionParams, Amount, AmountDenomination, i257, Route, DataType,
        VESU_SINGLETON,
    };

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
        // Strategy config — two Vesu pools
        vesu_singleton: ContractAddress,
        wbtc_pool_id: felt252,     // WBTC collateral pool (Re7 xBTC)
        usdc_pool_id: felt252,     // USDC yield pool (Re7 USDC Core)
        debt_asset: ContractAddress, // USDC address
        pragma_oracle: ContractAddress, // Pragma price oracle
        usdc_pool_debt_asset: ContractAddress, // debt_asset param for USDC pool position lookups
        // Strategy state
        wbtc_collateral: u256,
        usdc_debt: u256,
        usdc_deployed: u256,
        is_paused: bool,
        // AVNU exchange for flash unwind
        avnu_exchange: ContractAddress,
    }

    // ── Events ──────────────────────────────────────────────────────────

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Transfer: Transfer,
        Approval: Approval,
        Deposit: DepositEvent,
        Withdraw: WithdrawEvent,
        CollateralDeployed: CollateralDeployed,
        UsdcBorrowedAndDeployed: UsdcBorrowedAndDeployed,
        UsdcUnwound: UsdcUnwound,
        CollateralWithdrawn: CollateralWithdrawn,
        OwnershipTransferred: OwnershipTransferred,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Transfer { #[key] pub from: ContractAddress, #[key] pub to: ContractAddress, pub value: u256 }
    #[derive(Drop, starknet::Event)]
    pub struct Approval { #[key] pub owner: ContractAddress, #[key] pub spender: ContractAddress, pub value: u256 }
    #[derive(Drop, starknet::Event)]
    pub struct DepositEvent { #[key] pub sender: ContractAddress, #[key] pub owner: ContractAddress, pub assets: u256, pub shares: u256 }
    #[derive(Drop, starknet::Event)]
    pub struct WithdrawEvent { #[key] pub sender: ContractAddress, #[key] pub receiver: ContractAddress, #[key] pub owner: ContractAddress, pub assets: u256, pub shares: u256 }
    #[derive(Drop, starknet::Event)]
    pub struct CollateralDeployed { pub wbtc_amount: u256 }
    #[derive(Drop, starknet::Event)]
    pub struct UsdcBorrowedAndDeployed { pub usdc_borrowed: u256, pub usdc_deployed: u256 }
    #[derive(Drop, starknet::Event)]
    pub struct UsdcUnwound { pub usdc_withdrawn: u256, pub usdc_repaid: u256 }
    #[derive(Drop, starknet::Event)]
    pub struct CollateralWithdrawn { pub wbtc_amount: u256 }
    #[derive(Drop, starknet::Event)]
    pub struct OwnershipTransferred { pub previous_owner: ContractAddress, pub new_owner: ContractAddress }

    // ── Constructor ─────────────────────────────────────────────────────

    #[constructor]
    fn constructor(
        ref self: ContractState,
        asset: ContractAddress,
        owner: ContractAddress,
        vesu_singleton: ContractAddress,
        wbtc_pool_id: felt252,
        usdc_pool_id: felt252,
        debt_asset: ContractAddress,
        pragma_oracle: ContractAddress,
    ) {
        self.name.write("BTCVault Delta Neutral");
        self.symbol.write("yvBTC-DN");
        self.asset.write(asset);
        self.owner.write(owner);
        self.vesu_singleton.write(vesu_singleton);
        self.wbtc_pool_id.write(wbtc_pool_id);
        self.usdc_pool_id.write(usdc_pool_id);
        self.debt_asset.write(debt_asset);
        self.pragma_oracle.write(pragma_oracle);
        self.total_supply.write(0);
        self.total_assets_managed.write(0);
        self.wbtc_collateral.write(0);
        self.usdc_debt.write(0);
        self.usdc_deployed.write(0);
        self.is_paused.write(false);
        self.emit(OwnershipTransferred { previous_owner: Zero::zero(), new_owner: owner });
    }

    // ── ERC20 Implementation ────────────────────────────────────────────

    #[abi(embed_v0)]
    impl ERC20Impl of btcvault::interfaces::IERC20<ContractState> {
        fn name(self: @ContractState) -> ByteArray { self.name.read() }
        fn symbol(self: @ContractState) -> ByteArray { self.symbol.read() }
        fn decimals(self: @ContractState) -> u8 { 8_u8 }
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
            let wbtc = IERC20Dispatcher { contract_address: self.asset.read() };
            wbtc.transfer_from(caller, this, assets);
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
            let wbtc = IERC20Dispatcher { contract_address: self.asset.read() };
            wbtc.transfer_from(caller, this, assets);
            self._mint(receiver, shares);
            self.total_assets_managed.write(self.total_assets_managed.read() + assets);
            self.emit(DepositEvent { sender: caller, owner: receiver, assets, shares });
            self._deploy_to_strategy(assets);
            assets
        }

        fn max_withdraw(self: @ContractState, owner: ContractAddress) -> u256 {
            let owner_assets = self.convert_to_assets(self.balances.read(owner));
            let available = self._available_assets();
            if available < owner_assets { available } else { owner_assets }
        }
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

            let wbtc = IERC20Dispatcher { contract_address: self.asset.read() };
            let actual_balance = wbtc.balance_of(get_contract_address());
            let transfer_amount = if actual_balance < assets { actual_balance } else { assets };

            // Proportional share burn MUST take priority over full-balance burn.
            // On partial unwind, transfer_amount < assets. We must only burn proportional
            // shares, NOT all shares — otherwise user loses the locked Vesu position value.
            let owner_balance = self.balances.read(owner);
            let final_shares = if transfer_amount < assets && assets > 0 {
                let proportional = (shares * transfer_amount) / assets;
                if proportional == 0 && transfer_amount > 0 { 1_u256 } else { proportional }
            } else if shares >= owner_balance {
                owner_balance
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
            wbtc.transfer(receiver, transfer_amount);
            self._refresh_total_assets();
            self.emit(WithdrawEvent { sender: caller, receiver, owner, assets: transfer_amount, shares: final_shares });
            final_shares
        }

        fn max_redeem(self: @ContractState, owner: ContractAddress) -> u256 {
            let owner_shares = self.balances.read(owner);
            let available = self._available_assets();
            let supply = self.total_supply.read();
            let total = self.total_assets_managed.read();
            if supply == 0 || total == 0 { return 0; }
            let max_shares = (available * supply) / total;
            if max_shares < owner_shares { max_shares } else { owner_shares }
        }
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

            let wbtc = IERC20Dispatcher { contract_address: self.asset.read() };
            let actual_balance = wbtc.balance_of(get_contract_address());
            let transfer_amount = if actual_balance < assets { actual_balance } else { assets };

            // Proportional share burn MUST take priority over full-balance burn.
            // On partial unwind, transfer_amount < assets. We must only burn proportional
            // shares, NOT all shares — otherwise user loses the locked Vesu position value.
            let owner_balance = self.balances.read(owner);
            let final_shares = if transfer_amount < assets && assets > 0 {
                let proportional = (shares * transfer_amount) / assets;
                if proportional == 0 && transfer_amount > 0 { 1_u256 } else { proportional }
            } else if shares >= owner_balance {
                owner_balance
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
            wbtc.transfer(receiver, transfer_amount);
            self._refresh_total_assets();
            self.emit(WithdrawEvent { sender: caller, receiver, owner, assets: transfer_amount, shares: final_shares });
            transfer_amount
        }
    }

    // ── Curator Functions ───────────────────────────────────────────────

    #[abi(embed_v0)]
    impl CuratorImpl of super::IDeltaNeutralCurator<ContractState> {
        /// Supply WBTC as collateral to the WBTC pool
        fn deploy_collateral(ref self: ContractState, amount: u256) {
            self._assert_owner();
            assert(amount > 0, 'Vault: zero amount');
            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let wbtc_pool_addr: ContractAddress = self.wbtc_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: wbtc_pool_addr };
            let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };
            wbtc.approve(wbtc_pool_addr, amount);

            let params = ModifyPositionParams {
                collateral_asset: wbtc_addr,
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
            self.wbtc_collateral.write(self.wbtc_collateral.read() + amount);
            self.emit(CollateralDeployed { wbtc_amount: amount });
        }

        /// Borrow USDC against WBTC collateral, then supply USDC to the USDC yield pool
        fn borrow_and_deploy_usdc(ref self: ContractState, borrow_amount: u256) {
            self._assert_owner();
            assert(borrow_amount > 0, 'Vault: zero amount');
            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let usdc_addr = self.debt_asset.read();
            let wbtc_pool_addr: ContractAddress = self.wbtc_pool_id.read().try_into().unwrap();
            let usdc_pool_addr: ContractAddress = self.usdc_pool_id.read().try_into().unwrap();
            let wbtc_pool = IVesuPoolDispatcher { contract_address: wbtc_pool_addr };

            // Step 1: Borrow USDC from WBTC pool
            let borrow_params = ModifyPositionParams {
                collateral_asset: wbtc_addr,
                debt_asset: usdc_addr,
                user: this,
                collateral: Amount {
                    denomination: AmountDenomination::Assets,
                    value: i257 { abs: 0, is_negative: false },
                },
                debt: Amount {
                    denomination: AmountDenomination::Assets,
                    value: i257 { abs: borrow_amount, is_negative: false },
                },
            };
            wbtc_pool.modify_position(borrow_params);

            // Step 2: Supply USDC to USDC yield pool
            let usdc = IERC20Dispatcher { contract_address: usdc_addr };
            usdc.approve(usdc_pool_addr, borrow_amount);

            let usdc_pool = IVesuPoolDispatcher { contract_address: usdc_pool_addr };
            let supply_params = ModifyPositionParams {
                collateral_asset: usdc_addr,
                debt_asset: self.usdc_pool_debt_asset.read(),
                user: this,
                collateral: Amount {
                    denomination: AmountDenomination::Assets,
                    value: i257 { abs: borrow_amount, is_negative: false },
                },
                debt: Amount {
                    denomination: AmountDenomination::Assets,
                    value: i257 { abs: 0, is_negative: false },
                },
            };
            usdc_pool.modify_position(supply_params);

            self.usdc_debt.write(self.usdc_debt.read() + borrow_amount);
            self.usdc_deployed.write(self.usdc_deployed.read() + borrow_amount);
            self.emit(UsdcBorrowedAndDeployed { usdc_borrowed: borrow_amount, usdc_deployed: borrow_amount });
        }

        /// Withdraw USDC from yield pool, repay USDC debt
        fn unwind_usdc(ref self: ContractState, amount: u256) {
            self._assert_owner();
            assert(amount > 0, 'Vault: zero amount');
            let this = get_contract_address();
            let usdc_addr = self.debt_asset.read();
            let wbtc_addr = self.asset.read();
            let usdc_pool_addr: ContractAddress = self.usdc_pool_id.read().try_into().unwrap();
            let wbtc_pool_addr: ContractAddress = self.wbtc_pool_id.read().try_into().unwrap();
            let usdc_pool = IVesuPoolDispatcher { contract_address: usdc_pool_addr };

            // Step 1: Withdraw USDC from yield pool
            let withdraw_params = ModifyPositionParams {
                collateral_asset: usdc_addr,
                debt_asset: self.usdc_pool_debt_asset.read(),
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
            usdc_pool.modify_position(withdraw_params);

            // Step 2: Repay USDC debt on WBTC pool — approve both pool extension and singleton
            // Cap repay to balance - 2: Vesu rounds up actual transfer for debt repayment
            let usdc = IERC20Dispatcher { contract_address: usdc_addr };
            let usdc_bal = usdc.balance_of(this);
            let safe_max = if usdc_bal > 2 { usdc_bal - 2 } else { 0 };
            let actual_repay = if amount < safe_max { amount } else { safe_max };

            if actual_repay > 0 {
                let singleton_addr: ContractAddress = VESU_SINGLETON.try_into().unwrap();
                let approve_buf = actual_repay + actual_repay / 100 + 1;
                usdc.approve(wbtc_pool_addr, approve_buf);
                usdc.approve(singleton_addr, approve_buf);

                let wbtc_pool = IVesuPoolDispatcher { contract_address: wbtc_pool_addr };
                wbtc_pool.modify_position(ModifyPositionParams {
                    collateral_asset: wbtc_addr,
                    debt_asset: usdc_addr,
                    user: this,
                    collateral: Amount {
                        denomination: AmountDenomination::Assets,
                        value: i257 { abs: 0, is_negative: false },
                    },
                    debt: Amount {
                        denomination: AmountDenomination::Assets,
                        value: i257 { abs: actual_repay, is_negative: true },
                    },
                });
            }

            let prev_debt = self.usdc_debt.read();
            if actual_repay <= prev_debt { self.usdc_debt.write(prev_debt - actual_repay); }
            else { self.usdc_debt.write(0); }

            let prev_deployed = self.usdc_deployed.read();
            if amount <= prev_deployed { self.usdc_deployed.write(prev_deployed - amount); }
            else { self.usdc_deployed.write(0); }

            self.emit(UsdcUnwound { usdc_withdrawn: amount, usdc_repaid: actual_repay });
        }

        /// Withdraw WBTC collateral from the WBTC pool
        fn withdraw_collateral(ref self: ContractState, amount: u256) {
            self._assert_owner();
            assert(amount > 0, 'Vault: zero amount');
            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let wbtc_pool_addr: ContractAddress = self.wbtc_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: wbtc_pool_addr };

            let params = ModifyPositionParams {
                collateral_asset: wbtc_addr,
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
            let prev = self.wbtc_collateral.read();
            if amount <= prev { self.wbtc_collateral.write(prev - amount); }
            else { self.wbtc_collateral.write(0); }
            self.emit(CollateralWithdrawn { wbtc_amount: amount });
        }

        fn harvest(ref self: ContractState) {
            self._assert_owner();
            self._refresh_total_assets();
        }

        fn upgrade(ref self: ContractState, new_class_hash: ClassHash) {
            self._assert_owner();
            starknet::syscalls::replace_class_syscall(new_class_hash).unwrap_syscall();
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

        fn set_usdc_pool_id(ref self: ContractState, pool_id: felt252) {
            self._assert_owner();
            self.usdc_pool_id.write(pool_id);
        }

        fn set_usdc_pool_debt_asset(ref self: ContractState, debt_asset: ContractAddress) {
            self._assert_owner();
            self.usdc_pool_debt_asset.write(debt_asset);
        }

        fn set_wbtc_pool_id(ref self: ContractState, pool_id: felt252) {
            self._assert_owner();
            self.wbtc_pool_id.write(pool_id);
        }

        fn set_pragma_oracle(ref self: ContractState, oracle: ContractAddress) {
            self._assert_owner();
            self.pragma_oracle.write(oracle);
        }

        fn set_debt_asset(ref self: ContractState, debt_asset: ContractAddress) {
            self._assert_owner();
            self.debt_asset.write(debt_asset);
        }

        fn set_avnu_exchange(ref self: ContractState, avnu: ContractAddress) {
            self._assert_owner();
            self.avnu_exchange.write(avnu);
        }

        /// Atomically unwind the entire delta-neutral position using a Vesu flash loan.
        /// 1. Withdraw ALL USDC from Prime yield pool
        /// 2. Flash loan USDC to repay all Re7 debt
        /// 3. Withdraw all WBTC collateral from Re7
        /// 4. Swap small WBTC → USDC via AVNU to repay flash loan
        /// 5. Remaining WBTC becomes idle, available for user withdrawals.
        fn flash_unwind(ref self: ContractState, wbtc_to_sell: u256, min_usdc_out: u256, routes: Array<Route>) {
            self._assert_owner();

            let this = get_contract_address();
            let usdc_addr = self.debt_asset.read();
            let wbtc_addr = self.asset.read();
            let wbtc_pool_addr: ContractAddress = self.wbtc_pool_id.read().try_into().unwrap();
            let usdc_pool_addr: ContractAddress = self.usdc_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: wbtc_pool_addr };

            // Step 0: Withdraw ALL from Prime USDC pool
            let usdc_pool = IVesuPoolDispatcher { contract_address: usdc_pool_addr };
            let usdc_pool_da = self.usdc_pool_debt_asset.read();
            let (usdc_pos, _, _) = usdc_pool.position(usdc_addr, usdc_pool_da, this);
            if usdc_pos.collateral_shares > 0 {
                usdc_pool.modify_position(ModifyPositionParams {
                    collateral_asset: usdc_addr,
                    debt_asset: usdc_pool_da,
                    user: this,
                    collateral: Amount {
                        denomination: AmountDenomination::Native,
                        value: i257 { abs: usdc_pos.collateral_shares, is_negative: true },
                    },
                    debt: Amount {
                        denomination: AmountDenomination::Assets,
                        value: i257 { abs: 0, is_negative: false },
                    },
                });
            }
            self.usdc_deployed.write(0);

            // Step 1: Get current debt
            let (_pos, _coll_val, debt_val) = vesu.position(wbtc_addr, usdc_addr, this);
            assert(debt_val > 0, 'No debt to unwind');

            // Step 2: Serialize callback data
            let mut data: Array<felt252> = array![];
            wbtc_to_sell.serialize(ref data);
            min_usdc_out.serialize(ref data);
            routes.serialize(ref data);

            // Step 3: Flash loan full USDC debt — on_flash_loan handles the unwind
            vesu.flash_loan(this, usdc_addr, debt_val, false, data.span());

            // Refresh total assets after position is fully closed
            self._refresh_total_assets();
        }
    }

    // ── View Functions ──────────────────────────────────────────────────

    #[abi(embed_v0)]
    impl VaultViewImpl of super::IDeltaNeutralView<ContractState> {
        fn get_owner(self: @ContractState) -> ContractAddress { self.owner.read() }
        fn get_strategy_info(self: @ContractState) -> (u256, u256, u8, bool) {
            (self.wbtc_collateral.read(), self.usdc_debt.read(), 0, self.is_paused.read())
        }
        fn get_usdc_deployed(self: @ContractState) -> u256 { self.usdc_deployed.read() }
        fn get_debt_asset(self: @ContractState) -> ContractAddress { self.debt_asset.read() }
        fn get_usdc_pool_debt_asset(self: @ContractState) -> ContractAddress { self.usdc_pool_debt_asset.read() }
        fn get_wbtc_pool_id(self: @ContractState) -> felt252 { self.wbtc_pool_id.read() }
        fn get_usdc_pool_id(self: @ContractState) -> felt252 { self.usdc_pool_id.read() }
        fn get_avnu_exchange(self: @ContractState) -> ContractAddress { self.avnu_exchange.read() }

        fn min_deposit(self: @ContractState) -> u256 {
            let wbtc_addr = self.asset.read();
            let usdc_addr = self.debt_asset.read();
            let wbtc_pool_addr: ContractAddress = self.wbtc_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: wbtc_pool_addr };

            // Floor 1: WBTC collateral must be >= $10
            let wbtc_config = vesu.asset_config(wbtc_addr);
            let wbtc_price = vesu.price(wbtc_addr);
            let wbtc_min = if wbtc_price.value > 0 && wbtc_config.floor > 0 {
                (wbtc_config.floor * wbtc_config.scale) / wbtc_price.value + 1
            } else { 0 };

            // Floor 2: USDC debt (at 50% LTV borrow) must be >= $10
            // Need WBTC value >= 2 × USDC floor value to ensure 50% LTV borrow meets USDC floor
            let usdc_config = vesu.asset_config(usdc_addr);
            let usdc_price = vesu.price(usdc_addr);
            let wbtc_for_usdc = if wbtc_price.value > 0 && usdc_price.value > 0 && usdc_config.floor > 0 {
                let usdc_floor_tokens = (usdc_config.floor * usdc_config.scale) / usdc_price.value + 1;
                // WBTC needed = usdc_floor_tokens × 2 (for 50% LTV) × usdc_price / wbtc_price × wbtc_scale / usdc_scale
                (usdc_floor_tokens * usdc_price.value * wbtc_config.scale * 2) / (usdc_config.scale * wbtc_price.value) + 1
            } else { 0 };

            // Return the larger of the two minimums
            if wbtc_for_usdc > wbtc_min { wbtc_for_usdc } else { wbtc_min }
        }
    }

    // ── Internal Helpers ────────────────────────────────────────────────

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _assert_owner(self: @ContractState) { assert(get_caller_address() == self.owner.read(), 'Caller is not owner'); }

        fn _available_assets(self: @ContractState) -> u256 {
            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let usdc_addr = self.debt_asset.read();
            let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };
            let idle = wbtc.balance_of(this);

            let wbtc_pool_addr: ContractAddress = self.wbtc_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: wbtc_pool_addr };
            let (_pos, coll_val, debt_val) = vesu.position(wbtc_addr, usdc_addr, this);

            if debt_val > 0 && coll_val > 0 {
                let wp = vesu.price(wbtc_addr);
                let dp = vesu.price(usdc_addr);
                if wp.value > 0 && dp.value > 0 {
                    if debt_val * dp.value * 100 > coll_val * wp.value * 69 {
                        return idle;
                    }
                }
            }
            idle + coll_val
        }

        fn _refresh_total_assets(ref self: ContractState) {
            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let usdc_addr = self.debt_asset.read();
            let wbtc_pool_addr: ContractAddress = self.wbtc_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: wbtc_pool_addr };
            let (_pos, wbtc_coll_value, usdc_debt_value) = vesu.position(wbtc_addr, usdc_addr, this);
            let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };
            let idle = wbtc.balance_of(this);
            self.total_assets_managed.write(wbtc_coll_value + idle);
            self.wbtc_collateral.write(wbtc_coll_value);
            self.usdc_debt.write(usdc_debt_value);
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

        /// Full auto-deploy: supply WBTC → Pragma price → borrow USDC at 50% LTV → supply USDC
        fn _deploy_to_strategy(ref self: ContractState, amount: u256) {
            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let usdc_addr = self.debt_asset.read();
            let wbtc_pool_addr: ContractAddress = self.wbtc_pool_id.read().try_into().unwrap();
            let usdc_pool_addr: ContractAddress = self.usdc_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: wbtc_pool_addr };
            let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };

            // Query Vesu dust threshold: min = floor * scale / price
            let config = vesu.asset_config(wbtc_addr);
            let asset_price = vesu.price(wbtc_addr);
            if asset_price.value > 0 && config.floor > 0 {
                let min_amount = (config.floor * config.scale) / asset_price.value + 1;
                if amount < min_amount { return; }
            }

            // Step 1: Supply WBTC as collateral to WBTC pool
            wbtc.approve(wbtc_pool_addr, amount);
            vesu.modify_position(ModifyPositionParams {
                collateral_asset: wbtc_addr,
                debt_asset: usdc_addr,
                user: this,
                collateral: Amount {
                    denomination: AmountDenomination::Assets,
                    value: i257 { abs: amount, is_negative: false },
                },
                debt: Amount {
                    denomination: AmountDenomination::Assets,
                    value: i257 { abs: 0, is_negative: false },
                },
            });
            self.wbtc_collateral.write(self.wbtc_collateral.read() + amount);
            self.emit(CollateralDeployed { wbtc_amount: amount });

            // Step 2: Get BTC price from Pragma oracle
            let pragma = IPragmaOracleDispatcher { contract_address: self.pragma_oracle.read() };
            // 'BTC/USD' as felt252 = 0x4254432f555344
            let price_response = pragma.get_data_median(DataType::SpotEntry(0x4254432f555344));
            let btc_price: u256 = price_response.price.into();
            if btc_price == 0 { return; }

            // Step 3: Borrow USDC at 50% LTV
            // Formula: usdc_raw = wbtc_sats * btc_price_8dec * 50 / 10^12
            // (WBTC 8 dec + price 8 dec = 16 dec, USDC 6 dec → divide by 10^10, then * 50/100)
            let usdc_borrow = (amount * btc_price * 50) / 1000000000000;
            if usdc_borrow == 0 { return; }

            // Check USDC borrow meets Re7 debt floor ($10 minimum)
            let usdc_config = vesu.asset_config(self.debt_asset.read());
            let usdc_price = vesu.price(self.debt_asset.read());
            if usdc_price.value > 0 && usdc_config.floor > 0 {
                let min_usdc = (usdc_config.floor * usdc_config.scale) / usdc_price.value + 1;
                if usdc_borrow < min_usdc { return; }
            }

            vesu.modify_position(ModifyPositionParams {
                collateral_asset: wbtc_addr,
                debt_asset: usdc_addr,
                user: this,
                collateral: Amount {
                    denomination: AmountDenomination::Assets,
                    value: i257 { abs: 0, is_negative: false },
                },
                debt: Amount {
                    denomination: AmountDenomination::Assets,
                    value: i257 { abs: usdc_borrow, is_negative: false },
                },
            });

            // Step 4: Supply ALL borrowed USDC to Prime yield pool
            // Prime yield will cover the 1-2 microUSDC rounding gap on repay over time.
            let usdc = IERC20Dispatcher { contract_address: usdc_addr };
            usdc.approve(usdc_pool_addr, usdc_borrow);
            let usdc_pool = IVesuPoolDispatcher { contract_address: usdc_pool_addr };
            usdc_pool.modify_position(ModifyPositionParams {
                collateral_asset: usdc_addr,
                debt_asset: self.usdc_pool_debt_asset.read(),
                user: this,
                collateral: Amount {
                    denomination: AmountDenomination::Assets,
                    value: i257 { abs: usdc_borrow, is_negative: false },
                },
                debt: Amount {
                    denomination: AmountDenomination::Assets,
                    value: i257 { abs: 0, is_negative: false },
                },
            });

            self.usdc_debt.write(self.usdc_debt.read() + usdc_borrow);
            self.usdc_deployed.write(self.usdc_deployed.read() + usdc_borrow);
            self.emit(UsdcBorrowedAndDeployed { usdc_borrowed: usdc_borrow, usdc_deployed: usdc_borrow });
        }

        /// Full unwind: withdraw USDC from pool 2 → repay USDC debt → withdraw WBTC collateral
        fn _ensure_idle_balance(ref self: ContractState, needed: u256) {
            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };
            let idle = wbtc.balance_of(this);
            if idle >= needed { return; }

            let usdc_addr = self.debt_asset.read();
            let wbtc_pool_addr: ContractAddress = self.wbtc_pool_id.read().try_into().unwrap();
            let usdc_pool_addr: ContractAddress = self.usdc_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: wbtc_pool_addr };
            let usdc_pool = IVesuPoolDispatcher { contract_address: usdc_pool_addr };
            let usdc = IERC20Dispatcher { contract_address: usdc_addr };

            // Step 1: If USDC is deployed, withdraw ALL from yield pool
            // Use Native denomination (collateral_shares) for exact withdrawal — avoids rounding loss
            let usdc_deployed = self.usdc_deployed.read();
            if usdc_deployed > 0 {
                let usdc_pool_da = self.usdc_pool_debt_asset.read();
                let (usdc_pos, _, _) = usdc_pool.position(usdc_addr, usdc_pool_da, this);
                let shares_to_withdraw = usdc_pos.collateral_shares;
                if shares_to_withdraw > 0 {
                    usdc_pool.modify_position(ModifyPositionParams {
                        collateral_asset: usdc_addr,
                        debt_asset: usdc_pool_da,
                        user: this,
                        collateral: Amount {
                            denomination: AmountDenomination::Native,
                            value: i257 { abs: shares_to_withdraw, is_negative: true },
                        },
                        debt: Amount {
                            denomination: AmountDenomination::Assets,
                            value: i257 { abs: 0, is_negative: false },
                        },
                    });
                }
                self.usdc_deployed.write(0);
            }

            // Step 2: Unwind Vesu leveraged position
            let cur_idle = wbtc.balance_of(this);
            if cur_idle >= needed { return; }

            let (pos, wbtc_coll_val, on_chain_usdc_debt) = vesu.position(wbtc_addr, usdc_addr, this);

            if pos.collateral_shares == 0 {
                return; // No position to unwind
            }

            if on_chain_usdc_debt == 0 {
                // No debt — just withdraw all collateral
                vesu.modify_position(ModifyPositionParams {
                    collateral_asset: wbtc_addr,
                    debt_asset: usdc_addr,
                    user: this,
                    collateral: Amount {
                        denomination: AmountDenomination::Native,
                        value: i257 { abs: pos.collateral_shares, is_negative: true },
                    },
                    debt: Amount {
                        denomination: AmountDenomination::Assets,
                        value: i257 { abs: 0, is_negative: false },
                    },
                });
                self.wbtc_collateral.write(0);
                self.emit(CollateralWithdrawn { wbtc_amount: wbtc_coll_val });
                return;
            }

            // Has debt — check if Prime USDC covers it (common case after yield accrues)
            let usdc_bal = usdc.balance_of(this);
            if usdc_bal > on_chain_usdc_debt + 5 {
                // Simple full unwind: enough USDC to repay without swap
                let singleton_addr: ContractAddress = VESU_SINGLETON.try_into().unwrap();
                let max_u256: u256 = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
                usdc.approve(wbtc_pool_addr, max_u256);
                usdc.approve(singleton_addr, max_u256);
                vesu.modify_position(ModifyPositionParams {
                    collateral_asset: wbtc_addr,
                    debt_asset: usdc_addr,
                    user: this,
                    collateral: Amount {
                        denomination: AmountDenomination::Native,
                        value: i257 { abs: pos.collateral_shares, is_negative: true },
                    },
                    debt: Amount {
                        denomination: AmountDenomination::Native,
                        value: i257 { abs: pos.nominal_debt, is_negative: true },
                    },
                });
                self.usdc_debt.write(0);
                self.wbtc_collateral.write(0);
                self.emit(CollateralWithdrawn { wbtc_amount: wbtc_coll_val });
                return;
            }

            // Flash loan unwind: USDC doesn't fully cover debt (rounding gap).
            // Flash loan the debt, repay+withdraw in callback, sell minimal WBTC to cover gap.
            let avnu_addr = self.avnu_exchange.read();
            assert(avnu_addr != Zero::zero(), 'AVNU not set');

            let wbtc_price = vesu.price(wbtc_addr);
            let usdc_price = vesu.price(usdc_addr);
            assert(wbtc_price.value > 0 && usdc_price.value > 0, 'Invalid oracle prices');

            // Calculate gap: how much more USDC we need beyond what Prime gave us
            let gap = on_chain_usdc_debt - usdc_bal + 500_000; // 0.5 USDC buffer
            // Convert gap to WBTC: gap_usdc * usdc_price * 100 / wbtc_price (6dec→8dec)
            let gap_wbtc = (gap * usdc_price.value * 100) / wbtc_price.value;
            // 2x buffer for swap slippage, minimum 100 sats
            let wbtc_to_sell = if gap_wbtc * 2 > 100 { gap_wbtc * 2 } else { 100 };

            // Build hardcoded Ekubo WBTC/USDC route (same pool AVNU uses)
            let wbtc_felt: felt252 = wbtc_addr.into();
            let usdc_felt: felt252 = usdc_addr.into();
            let wbtc_u: u256 = wbtc_felt.into();
            let usdc_u: u256 = usdc_felt.into();
            let (token0, token1) = if wbtc_u < usdc_u {
                (wbtc_felt, usdc_felt)
            } else {
                (usdc_felt, wbtc_felt)
            };
            let ekubo_core: ContractAddress =
                0x00000005dd3d2f4429af886cd1a3b08289dbcea99a294197e9eb43b0e0325b4b
                .try_into().unwrap();
            let swap_params: Array<felt252> = array![
                token0, token1,
                0x20c49ba5e353f80000000000000000, // fee 0.05%
                0x3e8,                             // tick_spacing 1000
                0x0,                               // extension
                0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF, // sqrt_ratio_limit (max)
            ];
            let routes: Array<Route> = array![Route {
                token_from: wbtc_addr,
                token_to: usdc_addr,
                exchange_address: ekubo_core,
                percent: 1000000000000_u128,
                additional_swap_params: swap_params.span(),
            }];

            // Serialize flash loan callback data
            let mut data: Array<felt252> = array![];
            wbtc_to_sell.serialize(ref data);
            gap.serialize(ref data); // min_usdc_out = gap amount
            routes.serialize(ref data);

            // Flash loan full USDC debt — on_flash_loan handles repay + swap
            vesu.flash_loan(this, usdc_addr, on_chain_usdc_debt, false, data.span());

            self._refresh_total_assets();
        }
    }

    // ── Flash Loan Receiver ─────────────────────────────────────────────

    #[abi(embed_v0)]
    impl FlashloanReceiverImpl of btcvault::interfaces::IFlashloanReceiver<ContractState> {
        /// Called by Vesu pool during flash_loan. Executes the full unwind:
        /// 1. Repay ALL USDC debt + withdraw ALL WBTC collateral from Re7
        /// 2. Swap WBTC → USDC via AVNU to cover flash loan repayment gap
        fn on_flash_loan(
            ref self: ContractState,
            sender: ContractAddress,
            asset: ContractAddress,
            amount: u256,
            data: Span<felt252>,
        ) {
            let this = get_contract_address();
            let wbtc_pool_addr: ContractAddress = self.wbtc_pool_id.read().try_into().unwrap();

            // Security: only the Vesu pool can call this, and only we can initiate it
            assert(get_caller_address() == wbtc_pool_addr, 'Only pool can callback');
            assert(sender == this, 'Only self can initiate');

            let wbtc_addr = self.asset.read();
            let usdc_addr = self.debt_asset.read();
            let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };
            let usdc = IERC20Dispatcher { contract_address: usdc_addr };
            let vesu = IVesuPoolDispatcher { contract_address: wbtc_pool_addr };
            let singleton_addr: ContractAddress = VESU_SINGLETON.try_into().unwrap();

            // Deserialize callback data
            let mut data_span = data;
            let wbtc_to_sell: u256 = Serde::deserialize(ref data_span).expect('bad wbtc_sell');
            let min_usdc_out: u256 = Serde::deserialize(ref data_span).expect('bad min_usdc');
            let routes: Array<Route> = Serde::deserialize(ref data_span).expect('bad routes');

            // Step 1: Repay ALL USDC debt + withdraw ALL WBTC collateral atomically
            let (pos, _coll_val, _debt_val) = vesu.position(wbtc_addr, usdc_addr, this);
            let max_u256: u256 = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
            usdc.approve(wbtc_pool_addr, max_u256);
            usdc.approve(singleton_addr, max_u256);

            vesu.modify_position(ModifyPositionParams {
                collateral_asset: wbtc_addr,
                debt_asset: usdc_addr,
                user: this,
                collateral: Amount {
                    denomination: AmountDenomination::Native,
                    value: i257 { abs: pos.collateral_shares, is_negative: true },
                },
                debt: Amount {
                    denomination: AmountDenomination::Native,
                    value: i257 { abs: pos.nominal_debt, is_negative: true },
                },
            });

            // Step 2: Swap WBTC → USDC via AVNU to cover flash loan repayment gap
            let avnu_addr = self.avnu_exchange.read();
            wbtc.approve(avnu_addr, wbtc_to_sell);
            let avnu = IAvnuExchangeDispatcher { contract_address: avnu_addr };
            avnu.multi_route_swap(
                wbtc_addr, wbtc_to_sell, usdc_addr, 0, min_usdc_out,
                this, 0, Zero::zero(), routes,
            );

            // Step 3: Approve pool for flash loan repayment pull
            usdc.approve(wbtc_pool_addr, amount);

            // Update storage — position is fully closed
            self.wbtc_collateral.write(0);
            self.usdc_debt.write(0);
        }
    }
}

use btcvault::interfaces::Route;

#[starknet::interface]
pub trait IDeltaNeutralCurator<TContractState> {
    fn deploy_collateral(ref self: TContractState, amount: u256);
    fn borrow_and_deploy_usdc(ref self: TContractState, borrow_amount: u256);
    fn unwind_usdc(ref self: TContractState, amount: u256);
    fn withdraw_collateral(ref self: TContractState, amount: u256);
    fn harvest(ref self: TContractState);
    fn upgrade(ref self: TContractState, new_class_hash: starknet::ClassHash);
    fn pause(ref self: TContractState);
    fn unpause(ref self: TContractState);
    fn transfer_ownership(ref self: TContractState, new_owner: starknet::ContractAddress);
    fn accept_ownership(ref self: TContractState);
    fn set_usdc_pool_id(ref self: TContractState, pool_id: felt252);
    fn set_usdc_pool_debt_asset(ref self: TContractState, debt_asset: starknet::ContractAddress);
    fn set_wbtc_pool_id(ref self: TContractState, pool_id: felt252);
    fn set_pragma_oracle(ref self: TContractState, oracle: starknet::ContractAddress);
    fn set_debt_asset(ref self: TContractState, debt_asset: starknet::ContractAddress);
    fn set_avnu_exchange(ref self: TContractState, avnu: starknet::ContractAddress);
    fn flash_unwind(ref self: TContractState, wbtc_to_sell: u256, min_usdc_out: u256, routes: Array<Route>);
}

#[starknet::interface]
pub trait IDeltaNeutralView<TContractState> {
    fn get_owner(self: @TContractState) -> starknet::ContractAddress;
    fn get_strategy_info(self: @TContractState) -> (u256, u256, u8, bool);
    fn get_usdc_deployed(self: @TContractState) -> u256;
    fn get_debt_asset(self: @TContractState) -> starknet::ContractAddress;
    fn get_usdc_pool_debt_asset(self: @TContractState) -> starknet::ContractAddress;
    fn get_wbtc_pool_id(self: @TContractState) -> felt252;
    fn get_usdc_pool_id(self: @TContractState) -> felt252;
    fn get_avnu_exchange(self: @TContractState) -> starknet::ContractAddress;
    fn min_deposit(self: @TContractState) -> u256;
}
