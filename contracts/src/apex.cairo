/// BTCVault Apex — Multi-Strategy (Vesu Leverage + Ekubo LP + Endur Staking)
///
/// Splits deposits three ways:
///   40% → Vesu leverage loop (supply WBTC, borrow USDC, AVNU swap, re-deposit)
///   35% → Ekubo WBTC/ETH concentrated liquidity LP (earn swap fees)
///   25% → Endur xWBTC staking (earn validator rewards)
///
/// Implements ILocker callback for Ekubo LP operations.

#[starknet::contract]
pub mod BTCVaultApex {
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use starknet::ClassHash;
    use starknet::SyscallResultTrait;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess, StorageMapReadAccess, StorageMapWriteAccess};
    use core::num::traits::Zero;

    use btcvault::interfaces::{
        IERC20Dispatcher, IERC20DispatcherTrait,
        IERC4626Dispatcher, IERC4626DispatcherTrait,
        IVesuPoolDispatcher, IVesuPoolDispatcherTrait,
        IAvnuExchangeDispatcher, IAvnuExchangeDispatcherTrait,
        IEkuboPositionsDispatcher, IEkuboPositionsDispatcherTrait,
        IEkuboCoreDispatcher, IEkuboCoreDispatcherTrait,
        IPragmaOracleDispatcher, IPragmaOracleDispatcherTrait,
        ModifyPositionParams, Amount, AmountDenomination, i257, Route,
        PoolKey, Bounds, i129, DataType, PoolPrice, GetTokenInfoResult,
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
        // Strategy config
        endur_vault: ContractAddress,
        vesu_singleton: ContractAddress,
        vesu_pool_id: felt252,
        avnu_exchange: ContractAddress,
        debt_asset: ContractAddress,       // USDC
        pragma_oracle: ContractAddress,    // Pragma price oracle
        ekubo_core: ContractAddress,
        ekubo_positions: ContractAddress,
        split_lending_bps: u256,           // e.g. 4000 = 40%
        split_lp_bps: u256,               // e.g. 3500 = 35%
        // Pillar 1: Vesu leverage state
        vesu_collateral: u256,
        vesu_debt: u256,
        leverage_loops: u8,
        // Pillar 2: Ekubo LP state
        ekubo_position_id: u64,
        ekubo_liquidity: u128,
        ekubo_wbtc_deployed: u256,    // WBTC cost-basis deployed to Ekubo LP
        ekubo_lower_mag: u128,        // Stored LP tick range lower bound magnitude
        ekubo_lower_sign: bool,       // Stored LP tick range lower bound sign
        ekubo_upper_mag: u128,        // Stored LP tick range upper bound magnitude
        ekubo_upper_sign: bool,       // Stored LP tick range upper bound sign
        // Pillar 3: Endur staking state
        endur_staked: u256,
        // Global
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
        LeverageExecuted: LeverageExecuted,
        Deleveraged: Deleveraged,
        EkuboDeployed: EkuboDeployed,
        EkuboWithdrawn: EkuboWithdrawn,
        EndurStaked: EndurStaked,
        SplitDeployed: SplitDeployed,
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
    pub struct LeverageExecuted { pub collateral: u256, pub debt: u256 }
    #[derive(Drop, starknet::Event)]
    pub struct Deleveraged { pub repaid: u256, pub withdrawn: u256 }
    #[derive(Drop, starknet::Event)]
    pub struct EkuboDeployed { pub wbtc_amount: u256, pub position_id: u64, pub liquidity: u128 }
    #[derive(Drop, starknet::Event)]
    pub struct EkuboWithdrawn { pub position_id: u64, pub token0_out: u256, pub token1_out: u256 }
    #[derive(Drop, starknet::Event)]
    pub struct EndurStaked { pub wbtc_in: u256, pub xwbtc_out: u256 }
    #[derive(Drop, starknet::Event)]
    pub struct SplitDeployed { pub lending: u256, pub lp: u256, pub staking: u256 }
    #[derive(Drop, starknet::Event)]
    pub struct OwnershipTransferred { pub previous_owner: ContractAddress, pub new_owner: ContractAddress }

    // ── Constructor ─────────────────────────────────────────────────────

    #[constructor]
    fn constructor(
        ref self: ContractState,
        asset: ContractAddress,
        owner: ContractAddress,
        endur_vault: ContractAddress,
        vesu_singleton: ContractAddress,
        vesu_pool_id: felt252,
        avnu_exchange: ContractAddress,
        debt_asset: ContractAddress,
        pragma_oracle: ContractAddress,
        ekubo_core: ContractAddress,
        ekubo_positions: ContractAddress,
        split_lending_bps: u256,
        split_lp_bps: u256,
    ) {
        self.name.write("BTCVault Apex");
        self.symbol.write("yvBTC-APEX");
        self.asset.write(asset);
        self.owner.write(owner);
        self.endur_vault.write(endur_vault);
        self.vesu_singleton.write(vesu_singleton);
        self.vesu_pool_id.write(vesu_pool_id);
        self.avnu_exchange.write(avnu_exchange);
        self.debt_asset.write(debt_asset);
        self.pragma_oracle.write(pragma_oracle);
        self.ekubo_core.write(ekubo_core);
        self.ekubo_positions.write(ekubo_positions);
        self.split_lending_bps.write(split_lending_bps);
        self.split_lp_bps.write(split_lp_bps);
        self.total_supply.write(0);
        self.total_assets_managed.write(0);
        self.vesu_collateral.write(0);
        self.vesu_debt.write(0);
        self.leverage_loops.write(0);
        self.ekubo_position_id.write(0);
        self.ekubo_liquidity.write(0);
        self.endur_staked.write(0);
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

            // If user is withdrawing their entire balance, burn all shares (prevents dust)
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
            wbtc.transfer(receiver, transfer_amount);
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
            // If shares are worthless (total_assets == 0), just burn them
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

            // If user is redeeming their entire balance, burn all shares (prevents dust)
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
            wbtc.transfer(receiver, transfer_amount);
            self.emit(WithdrawEvent { sender: caller, receiver, owner, assets: transfer_amount, shares: final_shares });
            transfer_amount
        }
    }

    // ── Curator Functions ───────────────────────────────────────────────

    #[abi(embed_v0)]
    impl CuratorImpl of super::IApexCurator<ContractState> {
        // ── Pillar 1: Vesu leverage loop (same as Turbo) ────────────────

        fn execute_leverage(
            ref self: ContractState,
            collateral_amount: u256,
            borrow_amount: u256,
            min_swap_out: u256,
            routes: Array<Route>,
        ) {
            self._assert_owner();
            assert(collateral_amount > 0, 'Vault: zero collateral');
            assert(borrow_amount > 0, 'Vault: zero borrow');

            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let debt_addr = self.debt_asset.read();
            let pool_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: pool_addr };
            let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };

            // Approve and deposit + borrow
            wbtc.approve(pool_addr, collateral_amount);
            let params = ModifyPositionParams {
                collateral_asset: wbtc_addr,
                debt_asset: debt_addr,
                user: this,
                collateral: Amount {
                    denomination: AmountDenomination::Assets,
                    value: i257 { abs: collateral_amount, is_negative: false },
                },
                debt: Amount {
                    denomination: AmountDenomination::Assets,
                    value: i257 { abs: borrow_amount, is_negative: false },
                },
            };
            vesu.modify_position(params);

            // Swap USDC → WBTC via AVNU
            let usdc = IERC20Dispatcher { contract_address: debt_addr };
            usdc.approve(self.avnu_exchange.read(), borrow_amount);
            let avnu = IAvnuExchangeDispatcher { contract_address: self.avnu_exchange.read() };
            avnu.multi_route_swap(
                debt_addr, borrow_amount, wbtc_addr, 0, min_swap_out,
                this, 0, Zero::zero(), routes,
            );

            // Re-deposit swapped WBTC
            let new_wbtc = wbtc.balance_of(this);
            if new_wbtc > 0 {
                wbtc.approve(pool_addr, new_wbtc);
                let redep = ModifyPositionParams {
                    collateral_asset: wbtc_addr,
                    debt_asset: debt_addr,
                    user: this,
                    collateral: Amount {
                        denomination: AmountDenomination::Assets,
                        value: i257 { abs: new_wbtc, is_negative: false },
                    },
                    debt: Amount {
                        denomination: AmountDenomination::Assets,
                        value: i257 { abs: 0, is_negative: false },
                    },
                };
                vesu.modify_position(redep);
            }

            self.vesu_collateral.write(self.vesu_collateral.read() + collateral_amount + new_wbtc);
            self.vesu_debt.write(self.vesu_debt.read() + borrow_amount);
            self.leverage_loops.write(self.leverage_loops.read() + 1);
            self.emit(LeverageExecuted { collateral: collateral_amount + new_wbtc, debt: borrow_amount });
        }

        fn deleverage(ref self: ContractState, repay_amount: u256, withdraw_collateral: u256) {
            self._assert_owner();
            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let debt_addr = self.debt_asset.read();
            let pool_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: pool_addr };

            let mut actual_repay = repay_amount;
            if repay_amount > 0 {
                let usdc = IERC20Dispatcher { contract_address: debt_addr };
                let usdc_bal = usdc.balance_of(this);
                // Leave 2-unit buffer: Vesu rounds up actual transfer for debt repayment
                let safe_max = if usdc_bal > 2 { usdc_bal - 2 } else { 0 };
                if actual_repay > safe_max { actual_repay = safe_max; }
                let singleton_addr: ContractAddress = VESU_SINGLETON.try_into().unwrap();
                let approve_buf = actual_repay + actual_repay / 100 + 1;
                usdc.approve(pool_addr, approve_buf);
                usdc.approve(singleton_addr, approve_buf);
            }

            let params = ModifyPositionParams {
                collateral_asset: wbtc_addr,
                debt_asset: debt_addr,
                user: this,
                collateral: Amount {
                    denomination: AmountDenomination::Assets,
                    value: i257 { abs: withdraw_collateral, is_negative: true },
                },
                debt: Amount {
                    denomination: AmountDenomination::Assets,
                    value: i257 { abs: actual_repay, is_negative: true },
                },
            };
            vesu.modify_position(params);

            let prev_c = self.vesu_collateral.read();
            if withdraw_collateral <= prev_c { self.vesu_collateral.write(prev_c - withdraw_collateral); }
            else { self.vesu_collateral.write(0); }
            let prev_d = self.vesu_debt.read();
            if actual_repay <= prev_d { self.vesu_debt.write(prev_d - actual_repay); }
            else { self.vesu_debt.write(0); }

            self.emit(Deleveraged { repaid: actual_repay, withdrawn: withdraw_collateral });
        }

        // ── Pillar 2: Ekubo LP ──────────────────────────────────────────

        /// Deploy WBTC to Ekubo WBTC/ETH LP:
        /// 1. Swap half of WBTC → ETH via AVNU
        /// 2. Transfer both tokens to Ekubo Positions contract
        /// 3. Call mint_and_deposit — Positions reads balanceOf(self) and handles Core internally
        fn deploy_to_ekubo(
            ref self: ContractState,
            wbtc_amount: u256,
            eth_min_out: u256,
            routes: Array<Route>,
            pool_key: PoolKey,
            bounds: Bounds,
            min_liquidity: u128,
        ) {
            self._assert_owner();
            assert(wbtc_amount > 0, 'Vault: zero amount');

            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };

            // Swap half WBTC → ETH via AVNU
            let half = wbtc_amount / 2;
            wbtc.approve(self.avnu_exchange.read(), half);
            let avnu = IAvnuExchangeDispatcher { contract_address: self.avnu_exchange.read() };

            let eth_addr: ContractAddress = 0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7.try_into().unwrap();
            avnu.multi_route_swap(
                wbtc_addr, half, eth_addr, 0, eth_min_out, this, 0, Zero::zero(), routes,
            );

            // Calculate LP amounts (don't use balance_of to avoid sweeping all idle WBTC)
            let wbtc_for_lp = wbtc_amount - half;
            let eth = IERC20Dispatcher { contract_address: eth_addr };
            let eth_for_lp = eth.balance_of(this);

            // Transfer tokens to Positions contract (Ekubo pattern: Positions reads balanceOf(self))
            let positions_addr = self.ekubo_positions.read();
            let positions = IEkuboPositionsDispatcher { contract_address: positions_addr };
            wbtc.transfer(positions_addr, wbtc_for_lp);
            eth.transfer(positions_addr, eth_for_lp);

            // Mint or add to existing LP position
            let existing_pos = self.ekubo_position_id.read();
            if existing_pos == 0 {
                // New position
                let (position_id, liquidity) = positions.mint_and_deposit(pool_key, bounds, min_liquidity);
                self.ekubo_position_id.write(position_id);
                self.ekubo_liquidity.write(liquidity);
                self.ekubo_wbtc_deployed.write(self.ekubo_wbtc_deployed.read() + wbtc_amount);
                // Store bounds for future deposits/withdrawals
                self.ekubo_lower_mag.write(bounds.lower.mag);
                self.ekubo_lower_sign.write(bounds.lower.sign);
                self.ekubo_upper_mag.write(bounds.upper.mag);
                self.ekubo_upper_sign.write(bounds.upper.sign);
                self.emit(EkuboDeployed { wbtc_amount, position_id, liquidity });
            } else {
                // Add to existing position
                let added_liq = positions.deposit(existing_pos, pool_key, bounds, min_liquidity);
                self.ekubo_liquidity.write(self.ekubo_liquidity.read() + added_liq);
                self.ekubo_wbtc_deployed.write(self.ekubo_wbtc_deployed.read() + wbtc_amount);
                self.emit(EkuboDeployed { wbtc_amount, position_id: existing_pos, liquidity: added_liq });
            };
        }

        /// Withdraw from Ekubo LP position
        fn withdraw_from_ekubo(
            ref self: ContractState,
            liquidity: u128,
            pool_key: PoolKey,
            bounds: Bounds,
            min_token0: u128,
            min_token1: u128,
        ) {
            self._assert_owner();
            let positions_addr = self.ekubo_positions.read();
            let positions = IEkuboPositionsDispatcher { contract_address: positions_addr };
            let pos_id = self.ekubo_position_id.read();

            let (t0, t1) = positions.withdraw(
                pos_id, pool_key, bounds, liquidity, min_token0, min_token1, true,
            );
            let token0_out: u256 = t0.into();
            let token1_out: u256 = t1.into();

            let prev_liq = self.ekubo_liquidity.read();
            let prev_wbtc = self.ekubo_wbtc_deployed.read();
            if liquidity <= prev_liq && prev_liq > 0 {
                self.ekubo_liquidity.write(prev_liq - liquidity);
                // Reduce tracked WBTC proportionally
                let reduced = (prev_wbtc * liquidity.into()) / prev_liq.into();
                if reduced <= prev_wbtc { self.ekubo_wbtc_deployed.write(prev_wbtc - reduced); }
                else { self.ekubo_wbtc_deployed.write(0); }
            } else {
                self.ekubo_liquidity.write(0);
                self.ekubo_wbtc_deployed.write(0);
            }

            self._refresh_total_assets();
            self.emit(EkuboWithdrawn { position_id: pos_id, token0_out, token1_out });
        }

        // ── Pillar 3: Endur staking ─────────────────────────────────────

        fn stake_to_endur(ref self: ContractState, amount: u256) {
            self._assert_owner();
            assert(amount > 0, 'Vault: zero amount');
            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let endur_addr = self.endur_vault.read();

            let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };
            wbtc.approve(endur_addr, amount);

            let endur = IERC4626Dispatcher { contract_address: endur_addr };
            let xwbtc_shares = endur.deposit(amount, this);

            self.endur_staked.write(self.endur_staked.read() + xwbtc_shares);
            self.emit(EndurStaked { wbtc_in: amount, xwbtc_out: xwbtc_shares });
        }

        // ── Auto-split deploy ───────────────────────────────────────────

        /// Auto-split amount by configured bps: lending / lp / staking
        /// Note: LP and staking portions are held as idle WBTC until curator
        /// manually deploys them (deploy_to_ekubo / stake_to_endur) since those
        /// require extra parameters (routes, pool_key, bounds, etc.)
        fn deploy_split(ref self: ContractState, amount: u256) {
            self._assert_owner();
            assert(amount > 0, 'Vault: zero amount');

            let lending_bps = self.split_lending_bps.read();
            let lp_bps = self.split_lp_bps.read();

            let lending_amount = (amount * lending_bps) / 10000;
            let lp_amount = (amount * lp_bps) / 10000;
            let staking_amount = amount - lending_amount - lp_amount;

            // Deploy lending portion to Vesu immediately
            if lending_amount > 0 {
                let this = get_contract_address();
                let wbtc_addr = self.asset.read();
                let pool_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();
                let vesu = IVesuPoolDispatcher { contract_address: pool_addr };
                let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };
                wbtc.approve(pool_addr, lending_amount);

                let params = ModifyPositionParams {
                    collateral_asset: wbtc_addr,
                    debt_asset: self.debt_asset.read(),
                    user: this,
                    collateral: Amount {
                        denomination: AmountDenomination::Assets,
                        value: i257 { abs: lending_amount, is_negative: false },
                    },
                    debt: Amount {
                        denomination: AmountDenomination::Assets,
                        value: i257 { abs: 0, is_negative: false },
                    },
                };
                vesu.modify_position(params);
                self.vesu_collateral.write(self.vesu_collateral.read() + lending_amount);
            }

            // LP and staking portions remain idle until manual deploy
            self.emit(SplitDeployed { lending: lending_amount, lp: lp_amount, staking: staking_amount });
        }

        // ── Flash Unwind Functions ────────────────────────────────────────

        /// Atomically unwind the Vesu leveraged position using a flash loan.
        /// Same pattern as Turbo: flash loan USDC, repay debt, free WBTC, swap WBTC->USDC.
        fn flash_unwind_vesu(ref self: ContractState, wbtc_to_sell: u256, min_usdc_out: u256, routes: Array<Route>) {
            self._assert_owner();

            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let debt_addr = self.debt_asset.read();
            let pool_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: pool_addr };

            let (_pos, _coll_val, debt_val) = vesu.position(wbtc_addr, debt_addr, this);
            assert(debt_val > 0, 'No debt to unwind');

            let mut data: Array<felt252> = array![];
            wbtc_to_sell.serialize(ref data);
            min_usdc_out.serialize(ref data);
            routes.serialize(ref data);

            vesu.flash_loan(this, debt_addr, debt_val, false, data.span());
            self._refresh_total_assets();
        }

        /// Swap ALL idle xWBTC -> WBTC via AVNU.
        /// Endur xWBTC has a 7-day withdrawal queue, so we swap via AVNU instead.
        fn unwind_endur(ref self: ContractState, min_amount_out: u256, routes: Array<Route>) {
            self._assert_owner();

            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let endur_addr = self.endur_vault.read();
            let xwbtc_token = IERC20Dispatcher { contract_address: endur_addr };
            let xwbtc_balance = xwbtc_token.balance_of(this);
            assert(xwbtc_balance > 0, 'No xWBTC to swap');

            let avnu_addr = self.avnu_exchange.read();
            xwbtc_token.approve(avnu_addr, xwbtc_balance);

            let avnu = IAvnuExchangeDispatcher { contract_address: avnu_addr };
            avnu.multi_route_swap(
                endur_addr, xwbtc_balance, wbtc_addr, 0, min_amount_out,
                this, 0, Zero::zero(), routes,
            );

            self.endur_staked.write(0);
            self._refresh_total_assets();
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

        fn set_vesu_pool(ref self: ContractState, pool_id: felt252) {
            self._assert_owner();
            self.vesu_pool_id.write(pool_id);
        }

        fn set_debt_asset(ref self: ContractState, debt_asset: ContractAddress) {
            self._assert_owner();
            self.debt_asset.write(debt_asset);
        }

        fn set_ekubo(ref self: ContractState, core: ContractAddress, positions: ContractAddress) {
            self._assert_owner();
            self.ekubo_core.write(core);
            self.ekubo_positions.write(positions);
        }
    }

    // ── Flash Loan Receiver ─────────────────────────────────────────────

    #[abi(embed_v0)]
    impl FlashloanReceiverImpl of btcvault::interfaces::IFlashloanReceiver<ContractState> {
        /// Called by Vesu pool during flash_loan. Executes the Vesu leverage unwind:
        /// 1. Repay ALL USDC debt + withdraw ALL WBTC collateral
        /// 2. Swap WBTC -> USDC via AVNU to repay flash loan
        fn on_flash_loan(
            ref self: ContractState,
            sender: ContractAddress,
            asset: ContractAddress,
            amount: u256,
            data: Span<felt252>,
        ) {
            let this = get_contract_address();
            let pool_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();

            assert(get_caller_address() == pool_addr, 'Only pool can callback');
            assert(sender == this, 'Only self can initiate');

            let wbtc_addr = self.asset.read();
            let debt_addr = self.debt_asset.read();
            let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };
            let usdc = IERC20Dispatcher { contract_address: debt_addr };
            let vesu = IVesuPoolDispatcher { contract_address: pool_addr };
            let singleton_addr: ContractAddress = VESU_SINGLETON.try_into().unwrap();

            let mut data_span = data;
            let wbtc_to_sell: u256 = Serde::deserialize(ref data_span).expect('bad wbtc_sell');
            let min_usdc_out: u256 = Serde::deserialize(ref data_span).expect('bad min_usdc');
            let routes: Array<Route> = Serde::deserialize(ref data_span).expect('bad routes');

            // Step 1: Repay ALL USDC debt and withdraw ALL WBTC collateral
            let (pos, _coll_val, debt_val) = vesu.position(wbtc_addr, debt_addr, this);

            let approve_buf = debt_val + debt_val / 50 + 100;
            usdc.approve(pool_addr, approve_buf);
            usdc.approve(singleton_addr, approve_buf);

            vesu.modify_position(ModifyPositionParams {
                collateral_asset: wbtc_addr, debt_asset: debt_addr, user: this,
                collateral: Amount {
                    denomination: AmountDenomination::Native,
                    value: i257 { abs: pos.collateral_shares, is_negative: true },
                },
                debt: Amount {
                    denomination: AmountDenomination::Assets,
                    value: i257 { abs: debt_val, is_negative: true },
                },
            });

            // Step 2: Swap WBTC -> USDC via AVNU
            let avnu_addr = self.avnu_exchange.read();
            wbtc.approve(avnu_addr, wbtc_to_sell);

            let avnu = IAvnuExchangeDispatcher { contract_address: avnu_addr };
            avnu.multi_route_swap(
                wbtc_addr, wbtc_to_sell, debt_addr, 0, min_usdc_out,
                this, 0, Zero::zero(), routes,
            );

            // Step 3: Approve USDC for flash loan repayment
            usdc.approve(pool_addr, amount);

            // Zero out Vesu storage
            self.vesu_collateral.write(0);
            self.vesu_debt.write(0);
            self.leverage_loops.write(0);
        }
    }

    // ── ILocker Implementation (Ekubo callback) ─────────────────────────

    #[abi(embed_v0)]
    impl LockerImpl of btcvault::interfaces::ILocker<ContractState> {
        fn locked(ref self: ContractState, id: u32, data: Span<felt252>) -> Span<felt252> {
            let _ = id;
            let _ = data;
            assert(get_caller_address() == self.ekubo_core.read(), 'Not Ekubo core');
            array![].span()
        }
    }

    // ── View Functions ──────────────────────────────────────────────────

    #[abi(embed_v0)]
    impl VaultViewImpl of super::IApexView<ContractState> {
        fn get_owner(self: @ContractState) -> ContractAddress { self.owner.read() }
        fn get_strategy_info(self: @ContractState) -> (u256, u256, u8, bool) {
            (self.vesu_collateral.read(), self.vesu_debt.read(), self.leverage_loops.read(), self.is_paused.read())
        }
        fn get_ekubo_position(self: @ContractState) -> (u64, u128) {
            (self.ekubo_position_id.read(), self.ekubo_liquidity.read())
        }
        fn get_endur_staked(self: @ContractState) -> u256 { self.endur_staked.read() }
        fn get_split_config(self: @ContractState) -> (u256, u256) {
            (self.split_lending_bps.read(), self.split_lp_bps.read())
        }
        fn min_deposit(self: @ContractState) -> u256 {
            // 40% goes to Vesu with 3 leverage loops: need 4× dust for Vesu portion
            // Total = vesu_dust * 4 * 100 / 40
            let vesu_min = self._vesu_dust_min() * 4;
            if vesu_min > 0 { (vesu_min * 100 + 39) / 40 } else { 0 }
        }
        fn get_vesu_pool_id(self: @ContractState) -> felt252 { self.vesu_pool_id.read() }
        fn get_debt_asset(self: @ContractState) -> ContractAddress { self.debt_asset.read() }
        fn get_avnu_exchange(self: @ContractState) -> ContractAddress { self.avnu_exchange.read() }
    }

    // ── Internal Helpers ────────────────────────────────────────────────

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _assert_owner(self: @ContractState) { assert(get_caller_address() == self.owner.read(), 'Caller is not owner'); }

        /// Vesu dust minimum for WBTC: floor * scale / price + 1
        fn _vesu_dust_min(self: @ContractState) -> u256 {
            let wbtc_addr = self.asset.read();
            let pool_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: pool_addr };
            let config = vesu.asset_config(wbtc_addr);
            let price = vesu.price(wbtc_addr);
            if price.value > 0 && config.floor > 0 {
                (config.floor * config.scale) / price.value + 1
            } else {
                0
            }
        }

        fn _available_assets(self: @ContractState) -> u256 {
            // Since _ensure_idle_balance auto-unwinds, report full net assets
            self.total_assets_managed.read()
        }

        /// Construct the hardcoded WBTC/ETH Ekubo pool key
        fn _ekubo_pool_key(self: @ContractState) -> PoolKey {
            let wbtc_addr = self.asset.read();
            let eth_addr: ContractAddress = 0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7.try_into().unwrap();
            PoolKey {
                token0: wbtc_addr,  // WBTC < ETH by address value
                token1: eth_addr,
                fee: 0x20c49ba5e353f80000000000000000,  // 0.05%
                tick_spacing: 1000,
                extension: Zero::zero(),
            }
        }

        /// Read stored Ekubo LP tick bounds
        fn _ekubo_bounds(self: @ContractState) -> Bounds {
            Bounds {
                lower: i129 { mag: self.ekubo_lower_mag.read(), sign: self.ekubo_lower_sign.read() },
                upper: i129 { mag: self.ekubo_upper_mag.read(), sign: self.ekubo_upper_sign.read() },
            }
        }

        fn _refresh_total_assets(ref self: ContractState) {
            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let debt_addr = self.debt_asset.read();
            let pool_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: pool_addr };
            let (_pos, vesu_collateral_value, debt_value) = vesu.position(wbtc_addr, debt_addr, this);

            let endur_staked_shares = self.endur_staked.read();
            let endur_value = if endur_staked_shares > 0 {
                let endur = IERC4626Dispatcher { contract_address: self.endur_vault.read() };
                endur.convert_to_assets(endur_staked_shares)
            } else { 0 };

            let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };
            let idle = wbtc.balance_of(this);

            // Live Ekubo LP valuation via get_token_info
            let ekubo_value = {
                let pos_id = self.ekubo_position_id.read();
                let liq = self.ekubo_liquidity.read();
                if pos_id > 0 && liq > 0 {
                    let positions = IEkuboPositionsDispatcher { contract_address: self.ekubo_positions.read() };
                    let pool_key = self._ekubo_pool_key();
                    let bounds = self._ekubo_bounds();
                    let info = positions.get_token_info(pos_id, pool_key, bounds);

                    // WBTC side (token0): principal + fees
                    let wbtc_lp: u256 = (info.amount0 + info.fees0).into();

                    // ETH side (token1): convert to WBTC using pool's sqrt_ratio
                    let eth_total: u256 = (info.amount1 + info.fees1).into();
                    if eth_total > 0 && info.pool_price.sqrt_ratio > 0 {
                        // inv_sqrt = 2^128 * WAD / sqrt_ratio
                        // eth_in_wbtc = (eth * inv_sqrt / WAD) * inv_sqrt / WAD
                        let two_pow_128: u256 = 0x100000000000000000000000000000000;
                        let wad: u256 = 1000000000000000000; // 10^18
                        let inv_sqrt = (two_pow_128 * wad) / info.pool_price.sqrt_ratio;
                        let step1 = (eth_total * inv_sqrt) / wad;
                        let eth_in_wbtc = (step1 * inv_sqrt) / wad;
                        wbtc_lp + eth_in_wbtc
                    } else {
                        wbtc_lp
                    }
                } else { 0 }
            };

            // Convert USDC debt to WBTC equivalent for net asset calculation
            let mut debt_in_wbtc: u256 = 0;
            if debt_value > 0 {
                let wp = vesu.price(wbtc_addr);
                let dp = vesu.price(debt_addr);
                if wp.value > 0 && dp.value > 0 {
                    // debt_in_wbtc(8-dec) = debt_value(6-dec) * usdc_price * 100 / wbtc_price
                    debt_in_wbtc = (debt_value * dp.value * 100) / wp.value;
                }
            }

            let gross = vesu_collateral_value + endur_value + idle + ekubo_value;
            let net = if debt_in_wbtc < gross { gross - debt_in_wbtc } else { 0 };

            self.total_assets_managed.write(net);
            self.vesu_collateral.write(vesu_collateral_value);
            self.vesu_debt.write(debt_value);
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

        /// Auto-split deploy: 40% → Vesu 3x leverage, 35% → Ekubo LP, 25% → Endur staking
        fn _deploy_to_strategy(ref self: ContractState, amount: u256) {
            let min_deposit_val = self._vesu_dust_min();
            // 40% goes to Vesu with 3 loops — ensure Vesu portion exceeds 4× dust
            let vesu_min_total = if min_deposit_val > 0 { (min_deposit_val * 4 * 100 + 39) / 40 } else { 0 };
            assert(amount >= vesu_min_total, 'Deposit below minimum');

            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let debt_addr = self.debt_asset.read();
            let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };

            // Split: 40% Vesu leverage, 35% Ekubo LP, 25% Endur staking
            let staking_amount = (amount * 25) / 100;
            let ekubo_amount = (amount * 35) / 100;
            let vesu_amount = amount - staking_amount - ekubo_amount;

            // ── Pillar 3: Stake 25% to Endur → xWBTC ──
            if staking_amount > 0 {
                let endur_addr = self.endur_vault.read();
                wbtc.approve(endur_addr, staking_amount);
                let endur = IERC4626Dispatcher { contract_address: endur_addr };
                let xwbtc_shares = endur.deposit(staking_amount, this);
                self.endur_staked.write(self.endur_staked.read() + xwbtc_shares);
                self.emit(EndurStaked { wbtc_in: staking_amount, xwbtc_out: xwbtc_shares });
            }

            // ── Pillar 2: Deploy 35% to Ekubo WBTC/ETH LP ──
            if ekubo_amount > 0 {
                let avnu_addr = self.avnu_exchange.read();
                let avnu = IAvnuExchangeDispatcher { contract_address: avnu_addr };
                let ekubo_core_addr = self.ekubo_core.read();
                let ekubo_core = IEkuboCoreDispatcher { contract_address: ekubo_core_addr };
                let positions_addr = self.ekubo_positions.read();
                let positions = IEkuboPositionsDispatcher { contract_address: positions_addr };

                let eth_addr: ContractAddress = 0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7.try_into().unwrap();
                let eth = IERC20Dispatcher { contract_address: eth_addr };
                let pool_key = self._ekubo_pool_key();

                // Read current pool price for slippage calculation and bounds
                let pool_price = ekubo_core.get_pool_price(pool_key);
                let two_pow_128: u256 = 0x100000000000000000000000000000000;

                // Swap half WBTC → ETH via AVNU with hardcoded Ekubo WBTC/ETH route
                let half = ekubo_amount / 2;
                wbtc.approve(avnu_addr, half);

                // min ETH out: use sqrt_ratio for expected, then 5% slippage
                let step1_e = (half * pool_price.sqrt_ratio) / two_pow_128;
                let expected_eth = (step1_e * pool_price.sqrt_ratio) / two_pow_128;
                let min_eth_out = (expected_eth * 95) / 100;

                // Hardcoded WBTC→ETH Ekubo route
                let wbtc_felt: felt252 = wbtc_addr.into();
                let eth_felt: felt252 = eth_addr.into();
                let swap_params_eth: Array<felt252> = array![
                    wbtc_felt, eth_felt,           // token0=WBTC, token1=ETH
                    0x20c49ba5e353f80000000000000000, // fee 0.05%
                    0x3e8,                             // tick_spacing 1000
                    0x0,                               // extension
                    0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF, // sqrt_ratio_distance (max)
                ];
                let routes_eth = array![Route {
                    token_from: wbtc_addr,
                    token_to: eth_addr,
                    exchange_address: ekubo_core_addr,
                    percent: 1000000000000,
                    additional_swap_params: swap_params_eth.span(),
                }];
                avnu.multi_route_swap(
                    wbtc_addr, half, eth_addr, 0, min_eth_out, this, 0, Zero::zero(), routes_eth,
                );

                // LP amounts: remaining WBTC half + all ETH from swap
                let wbtc_for_lp = ekubo_amount - half;
                let eth_for_lp = eth.balance_of(this);

                // Transfer tokens to Ekubo Positions contract
                wbtc.transfer(positions_addr, wbtc_for_lp);
                eth.transfer(positions_addr, eth_for_lp);

                let existing_pos = self.ekubo_position_id.read();
                if existing_pos == 0 {
                    // First deposit: compute tick bounds from current price
                    let current_tick_mag = pool_price.tick.mag;
                    let current_tick_sign = pool_price.tick.sign;
                    let range_ticks: u128 = 500000; // ±50% price range

                    // Lower bound: current_tick - range_ticks
                    let (lower_mag, lower_sign) = if current_tick_sign {
                        // Current tick is negative: lower = -(|tick| + range)
                        (current_tick_mag + range_ticks, true)
                    } else if current_tick_mag >= range_ticks {
                        (current_tick_mag - range_ticks, false)
                    } else {
                        (range_ticks - current_tick_mag, true)
                    };

                    // Upper bound: current_tick + range_ticks
                    let (upper_mag, upper_sign) = if current_tick_sign {
                        // Current tick is negative
                        if current_tick_mag > range_ticks {
                            (current_tick_mag - range_ticks, true)
                        } else {
                            (range_ticks - current_tick_mag, false)
                        }
                    } else {
                        (current_tick_mag + range_ticks, false)
                    };

                    // Round to tick_spacing (1000)
                    let lower_rounded = (lower_mag / 1000) * 1000;
                    let upper_rounded = ((upper_mag + 999) / 1000) * 1000;

                    let bounds = Bounds {
                        lower: i129 { mag: lower_rounded, sign: lower_sign },
                        upper: i129 { mag: upper_rounded, sign: upper_sign },
                    };

                    // Mint new LP position
                    let (position_id, liquidity) = positions.mint_and_deposit(pool_key, bounds, 0);

                    // Store position and bounds
                    self.ekubo_position_id.write(position_id);
                    self.ekubo_liquidity.write(liquidity);
                    self.ekubo_wbtc_deployed.write(ekubo_amount);
                    self.ekubo_lower_mag.write(lower_rounded);
                    self.ekubo_lower_sign.write(lower_sign);
                    self.ekubo_upper_mag.write(upper_rounded);
                    self.ekubo_upper_sign.write(upper_sign);

                    self.emit(EkuboDeployed { wbtc_amount: ekubo_amount, position_id, liquidity });
                } else {
                    // Subsequent deposit: add to existing position with stored bounds
                    let bounds = self._ekubo_bounds();
                    let added_liq = positions.deposit(existing_pos, pool_key, bounds, 0);

                    self.ekubo_liquidity.write(self.ekubo_liquidity.read() + added_liq);
                    self.ekubo_wbtc_deployed.write(self.ekubo_wbtc_deployed.read() + ekubo_amount);

                    self.emit(EkuboDeployed { wbtc_amount: ekubo_amount, position_id: existing_pos, liquidity: added_liq });
                }
            }

            // ── Pillar 1: Deploy 40% to Vesu with 3x leverage loop ──
            if vesu_amount > 0 {
                let pool_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();
                let vesu = IVesuPoolDispatcher { contract_address: pool_addr };
                let usdc = IERC20Dispatcher { contract_address: debt_addr };
                let avnu_addr = self.avnu_exchange.read();
                let avnu = IAvnuExchangeDispatcher { contract_address: avnu_addr };

                // Oracle prices for borrow calculation and slippage
                let wbtc_price = vesu.price(wbtc_addr);
                let usdc_price = vesu.price(debt_addr);
                assert(wbtc_price.value > 0 && usdc_price.value > 0, 'Invalid oracle prices');

                // Ekubo Core exchange for AVNU route
                let ekubo_core_addr2: ContractAddress = 0x00000005dd3d2f4429af886cd1a3b08289dbcea99a294197e9eb43b0e0325b4b.try_into().unwrap();

                let num_loops: u8 = 3;
                let mut remaining_wbtc = vesu_amount;
                let mut total_collateral: u256 = 0;
                let mut total_debt: u256 = 0;
                let mut i: u8 = 0;

                while i < num_loops {
                    // Calculate USDC borrow at 50% LTV
                    let borrow_usdc = (remaining_wbtc * wbtc_price.value * 50) / (usdc_price.value * 10000);
                    if borrow_usdc == 0 { break; }

                    // Deposit WBTC collateral + borrow USDC atomically
                    wbtc.approve(pool_addr, remaining_wbtc);
                    vesu.modify_position(ModifyPositionParams {
                        collateral_asset: wbtc_addr,
                        debt_asset: debt_addr,
                        user: this,
                        collateral: Amount {
                            denomination: AmountDenomination::Assets,
                            value: i257 { abs: remaining_wbtc, is_negative: false },
                        },
                        debt: Amount {
                            denomination: AmountDenomination::Assets,
                            value: i257 { abs: borrow_usdc, is_negative: false },
                        },
                    });
                    total_collateral += remaining_wbtc;
                    total_debt += borrow_usdc;

                    // Swap USDC → WBTC via AVNU with hardcoded Ekubo route
                    let usdc_balance = usdc.balance_of(this);
                    usdc.approve(avnu_addr, usdc_balance);

                    // min WBTC out with 5% slippage tolerance
                    let min_wbtc_out = (usdc_balance * usdc_price.value * 95) / wbtc_price.value;

                    // Ekubo pool key: token0 < token1 by address value
                    let wbtc_felt2: felt252 = wbtc_addr.into();
                    let debt_felt2: felt252 = debt_addr.into();
                    let wbtc_val2: u256 = wbtc_felt2.into();
                    let debt_val_u2: u256 = debt_felt2.into();
                    let (token0, token1) = if wbtc_val2 < debt_val_u2 {
                        (wbtc_felt2, debt_felt2)
                    } else {
                        (debt_felt2, wbtc_felt2)
                    };
                    let swap_params: Array<felt252> = array![
                        token0, token1,
                        0x20c49ba5e353f80000000000000000, // fee 0.05%
                        0x3e8,                             // tick_spacing 1000
                        0x0,                               // extension
                        0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF, // sqrt_ratio_distance (max)
                    ];
                    let routes = array![Route {
                        token_from: debt_addr,
                        token_to: wbtc_addr,
                        exchange_address: ekubo_core_addr2,
                        percent: 1000000000000,
                        additional_swap_params: swap_params.span(),
                    }];

                    avnu.multi_route_swap(
                        debt_addr, usdc_balance, wbtc_addr,
                        0, min_wbtc_out, this, 0, Zero::zero(), routes,
                    );

                    i += 1;
                    remaining_wbtc = wbtc.balance_of(this);
                    if remaining_wbtc < min_deposit_val { break; }
                };

                // Deposit leftover WBTC as final collateral (no borrow)
                let leftover = wbtc.balance_of(this);
                if leftover > 0 && leftover >= min_deposit_val {
                    wbtc.approve(pool_addr, leftover);
                    vesu.modify_position(ModifyPositionParams {
                        collateral_asset: wbtc_addr,
                        debt_asset: debt_addr,
                        user: this,
                        collateral: Amount {
                            denomination: AmountDenomination::Assets,
                            value: i257 { abs: leftover, is_negative: false },
                        },
                        debt: Amount {
                            denomination: AmountDenomination::Assets,
                            value: i257 { abs: 0, is_negative: false },
                        },
                    });
                    total_collateral += leftover;
                }

                self.vesu_collateral.write(self.vesu_collateral.read() + total_collateral);
                self.vesu_debt.write(self.vesu_debt.read() + total_debt);
                self.leverage_loops.write(self.leverage_loops.read() + i);
            }

            self._refresh_total_assets();
            self.emit(SplitDeployed { lending: vesu_amount, lp: ekubo_amount, staking: staking_amount });
        }

        /// Auto-unwind: if idle WBTC < needed, unwind Ekubo LP, Endur xWBTC, and/or
        /// flash-loan unwind Vesu position using hardcoded Ekubo routes.
        fn _ensure_idle_balance(ref self: ContractState, needed: u256) {
            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };
            let idle = wbtc.balance_of(this);

            if idle >= needed {
                return;
            }

            // --- Phase 0: Unwind Ekubo LP → WBTC + ETH, then swap ETH → WBTC ---
            let ekubo_liq = self.ekubo_liquidity.read();
            if ekubo_liq > 0 {
                let positions = IEkuboPositionsDispatcher { contract_address: self.ekubo_positions.read() };
                let pos_id = self.ekubo_position_id.read();
                let pool_key = self._ekubo_pool_key();
                let bounds = self._ekubo_bounds();

                // Withdraw ALL liquidity + collect fees
                positions.withdraw(pos_id, pool_key, bounds, ekubo_liq, 0, 0, true);

                // Swap ALL ETH → WBTC via AVNU (hardcoded Ekubo WBTC/ETH route)
                let eth_addr: ContractAddress = 0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7.try_into().unwrap();
                let eth = IERC20Dispatcher { contract_address: eth_addr };
                let eth_balance = eth.balance_of(this);

                if eth_balance > 0 {
                    let avnu_addr = self.avnu_exchange.read();
                    let avnu = IAvnuExchangeDispatcher { contract_address: avnu_addr };
                    eth.approve(avnu_addr, eth_balance);

                    let ekubo_core_addr: ContractAddress = self.ekubo_core.read();
                    let wbtc_felt: felt252 = wbtc_addr.into();
                    let eth_felt: felt252 = eth_addr.into();
                    let swap_params_eth: Array<felt252> = array![
                        wbtc_felt, eth_felt,               // token0=WBTC, token1=ETH
                        0x20c49ba5e353f80000000000000000,   // fee 0.05%
                        0x3e8,                              // tick_spacing 1000
                        0x0,                                // extension
                        0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF,  // sqrt_ratio_distance (max)
                    ];
                    let routes_eth = array![Route {
                        token_from: eth_addr,
                        token_to: wbtc_addr,
                        exchange_address: ekubo_core_addr,
                        percent: 1000000000000,
                        additional_swap_params: swap_params_eth.span(),
                    }];
                    // Emergency unwind: use 0 min to ensure it succeeds
                    avnu.multi_route_swap(
                        eth_addr, eth_balance, wbtc_addr, 0, 0, this, 0, Zero::zero(), routes_eth,
                    );
                }

                // Zero out Ekubo storage
                self.ekubo_position_id.write(0);
                self.ekubo_liquidity.write(0);
                self.ekubo_wbtc_deployed.write(0);
                self.ekubo_lower_mag.write(0);
                self.ekubo_lower_sign.write(false);
                self.ekubo_upper_mag.write(0);
                self.ekubo_upper_sign.write(false);
            }

            // Check if we have enough after Ekubo unwind
            let idle_after_ekubo = wbtc.balance_of(this);
            if idle_after_ekubo >= needed {
                self._refresh_total_assets();
                return;
            }

            // --- Phase 1: Unwind Endur xWBTC → WBTC via AVNU/Ekubo ---
            let endur_addr = self.endur_vault.read();
            let xwbtc_token = IERC20Dispatcher { contract_address: endur_addr };
            let xwbtc_balance = xwbtc_token.balance_of(this);

            if xwbtc_balance > 0 {
                let avnu_addr = self.avnu_exchange.read();
                let avnu = IAvnuExchangeDispatcher { contract_address: avnu_addr };
                let ekubo_core: ContractAddress = 0x00000005dd3d2f4429af886cd1a3b08289dbcea99a294197e9eb43b0e0325b4b.try_into().unwrap();

                xwbtc_token.approve(avnu_addr, xwbtc_balance);

                // Hardcoded Ekubo xWBTC/WBTC route
                let endur_felt: felt252 = endur_addr.into();
                let wbtc_felt: felt252 = wbtc_addr.into();
                let endur_val: u256 = endur_felt.into();
                let wbtc_val: u256 = wbtc_felt.into();
                let (token0, token1) = if wbtc_val < endur_val {
                    (wbtc_felt, endur_felt)
                } else {
                    (endur_felt, wbtc_felt)
                };
                let swap_params: Array<felt252> = array![
                    token0, token1,
                    0x68db8bac710cb4000000000000000, // xWBTC/WBTC fee
                    0xc8,                             // tick_spacing 200
                    0x0,                              // extension
                    0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF, // sqrt_ratio_distance (max)
                ];
                let routes = array![Route {
                    token_from: endur_addr,
                    token_to: wbtc_addr,
                    exchange_address: ekubo_core,
                    percent: 1000000000000,
                    additional_swap_params: swap_params.span(),
                }];

                // min_out = 95% of xWBTC balance (xWBTC ≈ WBTC 1:1)
                let min_out = (xwbtc_balance * 95) / 100;
                avnu.multi_route_swap(
                    endur_addr, xwbtc_balance, wbtc_addr,
                    0, min_out, this, 0, Zero::zero(), routes,
                );

                self.endur_staked.write(0);
            }

            // Check if we have enough now
            let idle2 = wbtc.balance_of(this);
            if idle2 >= needed {
                self._refresh_total_assets();
                return;
            }

            // --- Unwind Vesu position via flash loan ---
            let debt_addr = self.debt_asset.read();
            let pool_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: pool_addr };
            let (_pos, _coll_val, debt_val) = vesu.position(wbtc_addr, debt_addr, this);

            if debt_val == 0 {
                self._refresh_total_assets();
                return; // No leveraged position to unwind
            }

            // Calculate wbtc_to_sell from oracle prices with 5% buffer
            // debt_val is 6-dec (USDC), wbtc_to_sell is 8-dec (sats): *100 for decimal conversion
            let wbtc_price = vesu.price(wbtc_addr);
            let usdc_price = vesu.price(debt_addr);
            assert(wbtc_price.value > 0 && usdc_price.value > 0, 'Invalid oracle prices');
            let debt_in_wbtc = (debt_val * usdc_price.value * 100) / wbtc_price.value;
            let wbtc_to_sell = (debt_in_wbtc * 105) / 100;
            let min_usdc_out = debt_val;

            // Hardcoded Ekubo WBTC/USDC route
            let ekubo_core2: ContractAddress = 0x00000005dd3d2f4429af886cd1a3b08289dbcea99a294197e9eb43b0e0325b4b.try_into().unwrap();
            let wbtc_felt2: felt252 = wbtc_addr.into();
            let debt_felt2: felt252 = debt_addr.into();
            let wbtc_val2: u256 = wbtc_felt2.into();
            let debt_val_u2: u256 = debt_felt2.into();
            let (token0_2, token1_2) = if wbtc_val2 < debt_val_u2 {
                (wbtc_felt2, debt_felt2)
            } else {
                (debt_felt2, wbtc_felt2)
            };
            let swap_params2: Array<felt252> = array![
                token0_2, token1_2,
                0x20c49ba5e353f80000000000000000, // fee 0.05%
                0x3e8,                             // tick_spacing 1000
                0x0,                               // extension
                0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF, // sqrt_ratio_distance (max)
            ];
            let routes2: Array<Route> = array![Route {
                token_from: wbtc_addr,
                token_to: debt_addr,
                exchange_address: ekubo_core2,
                percent: 1000000000000,
                additional_swap_params: swap_params2.span(),
            }];

            // Serialize flash loan callback data
            let mut data: Array<felt252> = array![];
            wbtc_to_sell.serialize(ref data);
            min_usdc_out.serialize(ref data);
            routes2.serialize(ref data);

            // Flash loan USDC debt amount → on_flash_loan handles repay + swap
            vesu.flash_loan(this, debt_addr, debt_val, false, data.span());

            self._refresh_total_assets();
        }
    }
}

use btcvault::interfaces::{Route, PoolKey, Bounds};

#[starknet::interface]
pub trait IApexCurator<TContractState> {
    fn execute_leverage(
        ref self: TContractState,
        collateral_amount: u256,
        borrow_amount: u256,
        min_swap_out: u256,
        routes: Array<Route>,
    );
    fn deleverage(ref self: TContractState, repay_amount: u256, withdraw_collateral: u256);
    fn deploy_to_ekubo(
        ref self: TContractState,
        wbtc_amount: u256,
        eth_min_out: u256,
        routes: Array<Route>,
        pool_key: PoolKey,
        bounds: Bounds,
        min_liquidity: u128,
    );
    fn withdraw_from_ekubo(
        ref self: TContractState,
        liquidity: u128,
        pool_key: PoolKey,
        bounds: Bounds,
        min_token0: u128,
        min_token1: u128,
    );
    fn stake_to_endur(ref self: TContractState, amount: u256);
    fn deploy_split(ref self: TContractState, amount: u256);
    fn flash_unwind_vesu(ref self: TContractState, wbtc_to_sell: u256, min_usdc_out: u256, routes: Array<Route>);
    fn unwind_endur(ref self: TContractState, min_amount_out: u256, routes: Array<Route>);
    fn harvest(ref self: TContractState);
    fn upgrade(ref self: TContractState, new_class_hash: starknet::ClassHash);
    fn pause(ref self: TContractState);
    fn unpause(ref self: TContractState);
    fn transfer_ownership(ref self: TContractState, new_owner: starknet::ContractAddress);
    fn accept_ownership(ref self: TContractState);
    fn set_vesu_pool(ref self: TContractState, pool_id: felt252);
    fn set_debt_asset(ref self: TContractState, debt_asset: starknet::ContractAddress);
    fn set_ekubo(ref self: TContractState, core: starknet::ContractAddress, positions: starknet::ContractAddress);
}

#[starknet::interface]
pub trait IApexView<TContractState> {
    fn get_owner(self: @TContractState) -> starknet::ContractAddress;
    fn get_strategy_info(self: @TContractState) -> (u256, u256, u8, bool);
    fn get_ekubo_position(self: @TContractState) -> (u64, u128);
    fn get_endur_staked(self: @TContractState) -> u256;
    fn get_split_config(self: @TContractState) -> (u256, u256);
    fn min_deposit(self: @TContractState) -> u256;
    fn get_vesu_pool_id(self: @TContractState) -> felt252;
    fn get_debt_asset(self: @TContractState) -> starknet::ContractAddress;
    fn get_avnu_exchange(self: @TContractState) -> starknet::ContractAddress;
}
