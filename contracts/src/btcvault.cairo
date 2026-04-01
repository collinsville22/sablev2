/// BTCVault — ERC-4626 BTC Yield Vault on StarkNet
///
/// Accepts WBTC deposits, mints yvBTC shares (tokenized BTC yield).
/// Curator (owner) routes WBTC into Vesu lending pools for yield.
/// Supports leverage looping: deposit WBTC → borrow USDC → swap back → re-deposit.
///
/// Hackathon requirements covered:
///  1. BTC yield vault (intake WBTC, deploy to Vesu for yield)
///  2. Tokenized BTC yield representation (yvBTC share token)
///  3. Vault curator/manager system (owner role manages strategy)
///  4. Leverage looping (via execute_leverage_loop)

#[starknet::contract]
pub mod BTCVault {
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use starknet::ClassHash;
    use starknet::SyscallResultTrait;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess, StorageMapReadAccess, StorageMapWriteAccess};
    use core::num::traits::Zero;

    use btcvault::interfaces::{
        IERC20Dispatcher, IERC20DispatcherTrait,
        IVesuPoolDispatcher, IVesuPoolDispatcherTrait,
        IAvnuExchangeDispatcher, IAvnuExchangeDispatcherTrait,
        IPragmaOracleDispatcher, IPragmaOracleDispatcherTrait,
        ModifyPositionParams, Amount, AmountDenomination, i257, Route, DataType,
        VESU_SINGLETON,
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
        asset: ContractAddress,          // WBTC address
        total_assets_managed: u256,      // total WBTC under management
        // Vault management
        owner: ContractAddress,          // curator/manager
        pending_owner: ContractAddress,
        // Strategy config
        vesu_singleton: ContractAddress,
        vesu_pool_id: felt252,
        avnu_exchange: ContractAddress,
        debt_asset: ContractAddress,     // USDC for leverage looping
        pragma_oracle: ContractAddress,  // Pragma price oracle
        // Strategy state
        total_collateral_deposited: u256,
        total_debt_borrowed: u256,
        leverage_loops: u8,
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
        LeverageLoop: LeverageLoop,
        Deleverage: Deleverage,
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
    pub struct LeverageLoop {
        pub collateral_added: u256,
        pub debt_borrowed: u256,
        pub loops: u8,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Deleverage {
        pub debt_repaid: u256,
        pub collateral_withdrawn: u256,
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
        asset: ContractAddress,           // WBTC
        owner: ContractAddress,           // curator
        vesu_singleton: ContractAddress,
        vesu_pool_id: felt252,
        avnu_exchange: ContractAddress,
        debt_asset: ContractAddress,      // USDC
        pragma_oracle: ContractAddress,   // Pragma price feed
    ) {
        self.name.write("BTCVault Yield Token");
        self.symbol.write("yvBTC");
        self.asset.write(asset);
        self.owner.write(owner);
        self.vesu_singleton.write(vesu_singleton);
        self.vesu_pool_id.write(vesu_pool_id);
        self.avnu_exchange.write(avnu_exchange);
        self.debt_asset.write(debt_asset);
        self.pragma_oracle.write(pragma_oracle);
        self.total_supply.write(0);
        self.total_assets_managed.write(0);
        self.total_collateral_deposited.write(0);
        self.total_debt_borrowed.write(0);
        self.leverage_loops.write(0);
        self.is_paused.write(false);

        self.emit(OwnershipTransferred {
            previous_owner: Zero::zero(),
            new_owner: owner,
        });
    }

    // ── ERC20 Implementation ────────────────────────────────────────────

    #[abi(embed_v0)]
    impl ERC20Impl of btcvault::interfaces::IERC20<ContractState> {
        fn name(self: @ContractState) -> ByteArray {
            self.name.read()
        }

        fn symbol(self: @ContractState) -> ByteArray {
            self.symbol.read()
        }

        fn decimals(self: @ContractState) -> u8 {
            8_u8 // same as WBTC
        }

        fn total_supply(self: @ContractState) -> u256 {
            self.total_supply.read()
        }

        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }

        fn allowance(self: @ContractState, owner: ContractAddress, spender: ContractAddress) -> u256 {
            self.allowances.read((owner, spender))
        }

        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            let sender = get_caller_address();
            self._transfer(sender, recipient, amount);
            true
        }

        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool {
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
        fn asset(self: @ContractState) -> ContractAddress {
            self.asset.read()
        }

        fn total_assets(self: @ContractState) -> u256 {
            self.total_assets_managed.read()
        }

        fn convert_to_shares(self: @ContractState, assets: u256) -> u256 {
            let supply = self.total_supply.read();
            let total = self.total_assets_managed.read();
            if supply == 0 || total == 0 {
                assets // 1:1 when empty
            } else {
                (assets * supply) / total
            }
        }

        fn convert_to_assets(self: @ContractState, shares: u256) -> u256 {
            let supply = self.total_supply.read();
            let total = self.total_assets_managed.read();
            if supply == 0 {
                shares
            } else {
                (shares * total) / supply
            }
        }

        fn max_deposit(self: @ContractState, receiver: ContractAddress) -> u256 {
            let _ = receiver;
            if self.is_paused.read() {
                0
            } else {
                0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff_u256
            }
        }

        fn preview_deposit(self: @ContractState, assets: u256) -> u256 {
            self.convert_to_shares(assets)
        }

        fn deposit(ref self: ContractState, assets: u256, receiver: ContractAddress) -> u256 {
            assert(!self.is_paused.read(), 'Vault: paused');
            assert(assets > 0, 'Vault: zero assets');

            let shares = self.convert_to_shares(assets);
            assert(shares > 0, 'Vault: zero shares');

            let caller = get_caller_address();
            let this = get_contract_address();

            // Transfer WBTC from user to vault
            let wbtc = IERC20Dispatcher { contract_address: self.asset.read() };
            wbtc.transfer_from(caller, this, assets);

            // Mint yvBTC shares
            self._mint(receiver, shares);
            self.total_assets_managed.write(self.total_assets_managed.read() + assets);

            self.emit(DepositEvent { sender: caller, owner: receiver, assets, shares });

            self._deploy_to_strategy(assets);

            shares
        }

        fn max_mint(self: @ContractState, receiver: ContractAddress) -> u256 {
            let _ = receiver;
            if self.is_paused.read() {
                0
            } else {
                0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff_u256
            }
        }

        fn preview_mint(self: @ContractState, shares: u256) -> u256 {
            self.convert_to_assets(shares)
        }

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

        fn preview_withdraw(self: @ContractState, assets: u256) -> u256 {
            self.convert_to_shares(assets)
        }

        fn withdraw(
            ref self: ContractState,
            assets: u256,
            receiver: ContractAddress,
            owner: ContractAddress,
        ) -> u256 {
            self._refresh_total_assets();
            assert(assets > 0, 'Vault: zero assets');
            let shares = self.convert_to_shares(assets);
            assert(shares > 0, 'Vault: zero shares');

            let caller = get_caller_address();
            if caller != owner {
                let current_allowance = self.allowances.read((owner, caller));
                assert(current_allowance >= shares, 'Vault: insufficient allowance');
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
                let current_allowance = self.allowances.read((owner, caller));
                self.allowances.write((owner, caller), current_allowance - final_shares);
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

        fn preview_redeem(self: @ContractState, shares: u256) -> u256 {
            self.convert_to_assets(shares)
        }

        fn redeem(
            ref self: ContractState,
            shares: u256,
            receiver: ContractAddress,
            owner: ContractAddress,
        ) -> u256 {
            self._refresh_total_assets();
            assert(shares > 0, 'Vault: zero shares');
            let caller = get_caller_address();
            if caller != owner {
                let current_allowance = self.allowances.read((owner, caller));
                assert(current_allowance >= shares, 'Vault: insufficient allowance');
            }
            let assets = self.convert_to_assets(shares);
            // If shares are worthless (total_assets == 0), just burn them
            if assets == 0 {
                let owner_balance = self.balances.read(owner);
                let to_burn = if shares > owner_balance { owner_balance } else { shares };
                if caller != owner {
                    let current_allowance = self.allowances.read((owner, caller));
                    self.allowances.write((owner, caller), current_allowance - to_burn);
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
                let current_allowance = self.allowances.read((owner, caller));
                self.allowances.write((owner, caller), current_allowance - final_shares);
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

    // ── Flash Loan Receiver ─────────────────────────────────────────────

    #[abi(embed_v0)]
    impl FlashloanReceiverImpl of btcvault::interfaces::IFlashloanReceiver<ContractState> {
        /// Called by Vesu pool during flash_loan. Executes the full unwind:
        /// 1. Repay ALL USDC debt + withdraw ALL WBTC collateral
        /// 2. Swap WBTC → USDC via AVNU to repay flash loan
        fn on_flash_loan(
            ref self: ContractState,
            sender: ContractAddress,
            asset: ContractAddress,
            amount: u256,
            data: Span<felt252>,
        ) {
            let this = get_contract_address();
            let pool_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();

            // Security: only the Vesu pool can call this, and only we can initiate it
            assert(get_caller_address() == pool_addr, 'Only pool can callback');
            assert(sender == this, 'Only self can initiate');

            let wbtc_addr = self.asset.read();
            let debt_addr = self.debt_asset.read();
            let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };
            let usdc = IERC20Dispatcher { contract_address: debt_addr };
            let vesu = IVesuPoolDispatcher { contract_address: pool_addr };
            let singleton_addr: ContractAddress = VESU_SINGLETON.try_into().unwrap();

            // Deserialize callback data: wbtc_to_sell, min_usdc_out, routes
            let mut data_span = data;
            let wbtc_to_sell: u256 = Serde::deserialize(ref data_span).expect('bad wbtc_sell');
            let min_usdc_out: u256 = Serde::deserialize(ref data_span).expect('bad min_usdc');
            let routes: Array<Route> = Serde::deserialize(ref data_span).expect('bad routes');

            // Step 1: Repay ALL USDC debt and withdraw ALL WBTC collateral atomically
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

            // Step 2: Swap WBTC → USDC via AVNU to cover flash loan repayment
            let avnu_addr = self.avnu_exchange.read();
            wbtc.approve(avnu_addr, wbtc_to_sell);

            let avnu = IAvnuExchangeDispatcher { contract_address: avnu_addr };
            avnu.multi_route_swap(
                wbtc_addr,         // token_from: WBTC
                wbtc_to_sell,      // amount: curator-determined sell amount
                debt_addr,         // token_to: USDC
                0,                 // token_to_amount: not used
                min_usdc_out,      // min output: must cover flash loan
                this,              // beneficiary: vault
                0,                 // integrator_fee: 0
                Zero::zero(),      // fee_recipient: none
                routes,            // routes from curator
            );

            // Step 3: Approve USDC to pool for flash loan repayment pull
            usdc.approve(pool_addr, amount);

            // Update storage — position is fully closed
            self.total_collateral_deposited.write(0);
            self.total_debt_borrowed.write(0);
            self.leverage_loops.write(0);
        }
    }

    // ── Curator / Manager Functions ─────────────────────────────────────

    #[abi(embed_v0)]
    impl CuratorImpl of super::ICurator<ContractState> {
        /// Deposit idle WBTC from vault into Vesu lending pool
        fn deploy_to_vesu(ref self: ContractState, amount: u256) {
            self._assert_owner();
            assert(amount > 0, 'Vault: zero amount');

            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let pool_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: pool_addr };

            // Approve Vesu pool to spend our WBTC
            let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };
            wbtc.approve(pool_addr, amount);

            // Supply WBTC as collateral (positive delta = deposit)
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
            self.total_collateral_deposited.write(self.total_collateral_deposited.read() + amount);

            self.emit(StrategyDeposit { amount, pool_id: self.vesu_pool_id.read() });
        }

        /// Withdraw WBTC from Vesu back to vault
        fn withdraw_from_vesu(ref self: ContractState, amount: u256) {
            self._assert_owner();
            assert(amount > 0, 'Vault: zero amount');

            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let pool_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: pool_addr };

            // Withdraw collateral (negative delta = withdraw)
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
            let prev = self.total_collateral_deposited.read();
            if amount <= prev {
                self.total_collateral_deposited.write(prev - amount);
            } else {
                self.total_collateral_deposited.write(0);
            }

            self.emit(StrategyWithdraw { amount, pool_id: self.vesu_pool_id.read() });
        }

        /// Execute leverage loop: deposit WBTC → borrow USDC → swap USDC→WBTC → re-deposit
        /// This amplifies the BTC exposure and yield
        fn execute_leverage_loop(
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

            // Approve WBTC to Vesu pool
            let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };
            wbtc.approve(pool_addr, collateral_amount);

            // Step 1: Deposit WBTC collateral AND borrow USDC in one call
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

            // Step 2: Swap borrowed USDC → WBTC via AVNU
            let usdc = IERC20Dispatcher { contract_address: debt_addr };
            usdc.approve(self.avnu_exchange.read(), borrow_amount);

            let avnu = IAvnuExchangeDispatcher { contract_address: self.avnu_exchange.read() };
            avnu.multi_route_swap(
                debt_addr,        // sell USDC
                borrow_amount,    // sell amount
                wbtc_addr,        // buy WBTC
                0,                // expected (0 = use min)
                min_swap_out,     // minimum WBTC out (slippage protection)
                this,             // beneficiary = vault
                0,                // no integrator fee
                Zero::zero(),     // no fee recipient
                routes,
            );

            // Step 3: Re-deposit swapped WBTC as additional collateral
            let new_wbtc = wbtc.balance_of(this);
            if new_wbtc > 0 {
                wbtc.approve(pool_addr, new_wbtc);

                let redep_params = ModifyPositionParams {
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
                vesu.modify_position(redep_params);
            }

            // Update state
            self.total_collateral_deposited.write(
                self.total_collateral_deposited.read() + collateral_amount + new_wbtc
            );
            self.total_debt_borrowed.write(self.total_debt_borrowed.read() + borrow_amount);
            self.leverage_loops.write(self.leverage_loops.read() + 1);

            self.emit(LeverageLoop {
                collateral_added: collateral_amount + new_wbtc,
                debt_borrowed: borrow_amount,
                loops: self.leverage_loops.read(),
            });
        }

        /// Deleverage: repay debt and withdraw excess collateral
        fn deleverage(
            ref self: ContractState,
            repay_amount: u256,
            withdraw_collateral: u256,
        ) {
            self._assert_owner();

            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let debt_addr = self.debt_asset.read();
            let pool_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: pool_addr };

            // Cap repay to balance - 2: Vesu rounds up actual transfer for debt repayment
            let mut actual_repay = repay_amount;
            if repay_amount > 0 {
                let usdc = IERC20Dispatcher { contract_address: debt_addr };
                let usdc_bal = usdc.balance_of(this);
                let safe_max = if usdc_bal > 2 { usdc_bal - 2 } else { 0 };
                if actual_repay > safe_max { actual_repay = safe_max; }

                let singleton_addr: ContractAddress = VESU_SINGLETON.try_into().unwrap();
                let approve_buf = actual_repay + actual_repay / 100 + 1;
                usdc.approve(pool_addr, approve_buf);
                usdc.approve(singleton_addr, approve_buf);
            }

            // Repay debt (negative) and withdraw collateral (negative)
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

            let prev_collateral = self.total_collateral_deposited.read();
            if withdraw_collateral <= prev_collateral {
                self.total_collateral_deposited.write(prev_collateral - withdraw_collateral);
            } else {
                self.total_collateral_deposited.write(0);
            }
            let prev_debt = self.total_debt_borrowed.read();
            if actual_repay <= prev_debt {
                self.total_debt_borrowed.write(prev_debt - actual_repay);
            } else {
                self.total_debt_borrowed.write(0);
            }

            self.emit(Deleverage { debt_repaid: actual_repay, collateral_withdrawn: withdraw_collateral });
        }

        /// Atomically unwind the entire leveraged position using a Vesu flash loan.
        /// 1. Flash loan USDC to repay all debt
        /// 2. Withdraw all WBTC collateral from Vesu
        /// 3. Swap WBTC → USDC via AVNU to repay flash loan
        /// 4. Remaining WBTC becomes idle, available for user withdrawals.
        fn flash_unwind(ref self: ContractState, wbtc_to_sell: u256, min_usdc_out: u256, routes: Array<Route>) {
            self._assert_owner();

            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let debt_addr = self.debt_asset.read();
            let pool_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: pool_addr };

            let (_pos, _coll_val, debt_val) = vesu.position(wbtc_addr, debt_addr, this);
            assert(debt_val > 0, 'No debt to unwind');

            // Serialize wbtc_to_sell, min_usdc_out, and routes into flash loan callback data
            let mut data: Array<felt252> = array![];
            wbtc_to_sell.serialize(ref data);
            min_usdc_out.serialize(ref data);
            routes.serialize(ref data);

            // Flash loan the full USDC debt — on_flash_loan callback handles the unwind
            vesu.flash_loan(this, debt_addr, debt_val, false, data.span());

            // Refresh total assets after position is fully closed
            self._refresh_total_assets();
        }

        /// Harvest yield: read Vesu position value and update total_assets_managed
        /// to reflect accrued lending interest. This makes yvBTC share price increase.
        fn harvest(ref self: ContractState) {
            self._assert_owner();
            self._refresh_total_assets();
        }

        fn upgrade(ref self: ContractState, new_class_hash: ClassHash) {
            self._assert_owner();
            starknet::syscalls::replace_class_syscall(new_class_hash).unwrap_syscall();
        }

        /// Emergency pause
        fn pause(ref self: ContractState) {
            self._assert_owner();
            self.is_paused.write(true);
        }

        fn unpause(ref self: ContractState) {
            self._assert_owner();
            self.is_paused.write(false);
        }

        /// Transfer ownership (2-step)
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
    }

    // ── View Functions ──────────────────────────────────────────────────

    #[abi(embed_v0)]
    impl VaultViewImpl of super::IVaultView<ContractState> {
        fn get_owner(self: @ContractState) -> ContractAddress {
            self.owner.read()
        }

        fn get_strategy_info(self: @ContractState) -> (u256, u256, u8, bool) {
            (
                self.total_collateral_deposited.read(),
                self.total_debt_borrowed.read(),
                self.leverage_loops.read(),
                self.is_paused.read(),
            )
        }

        fn get_vesu_pool_id(self: @ContractState) -> felt252 {
            self.vesu_pool_id.read()
        }

        fn get_avnu_exchange(self: @ContractState) -> ContractAddress {
            self.avnu_exchange.read()
        }

        fn get_debt_asset(self: @ContractState) -> ContractAddress {
            self.debt_asset.read()
        }

        fn min_deposit(self: @ContractState) -> u256 {
            // 4x dust minimum ensures all 3 leverage loops can complete
            // (each loop returns ~50% from swap, so loop 3 input ≈ 25% of initial)
            self._vesu_dust_min() * 4
        }
    }

    // ── Internal Helpers ────────────────────────────────────────────────

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _assert_owner(self: @ContractState) {
            assert(get_caller_address() == self.owner.read(), 'Caller is not owner');
        }

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

        fn _refresh_total_assets(ref self: ContractState) {
            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let debt_addr = self.debt_asset.read();
            let pool_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: pool_addr };
            let (_position, collateral_value, debt_value) = vesu.position(wbtc_addr, debt_addr, this);
            let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };
            let idle_wbtc = wbtc.balance_of(this);

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

            let gross = collateral_value + idle_wbtc;
            let net = if debt_in_wbtc < gross { gross - debt_in_wbtc } else { 0 };

            self.total_assets_managed.write(net);
            self.total_collateral_deposited.write(collateral_value);
            self.total_debt_borrowed.write(debt_value);
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

        /// Deploy WBTC into Vesu with 3x leverage loop:
        /// deposit WBTC → borrow USDC → swap USDC→WBTC via AVNU/Ekubo → re-deposit
        fn _deploy_to_strategy(ref self: ContractState, amount: u256) {
            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let debt_addr = self.debt_asset.read();
            let pool_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: pool_addr };
            let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };
            let usdc = IERC20Dispatcher { contract_address: debt_addr };
            let avnu_addr = self.avnu_exchange.read();
            let avnu = IAvnuExchangeDispatcher { contract_address: avnu_addr };

            let min_deposit = self._vesu_dust_min();
            assert(amount >= min_deposit, 'Deposit below minimum');

            // Oracle prices for borrow calculation and slippage protection
            let wbtc_price = vesu.price(wbtc_addr);
            let usdc_price = vesu.price(debt_addr);
            assert(wbtc_price.value > 0 && usdc_price.value > 0, 'Invalid oracle prices');

            // Ekubo Core exchange address for AVNU route
            let ekubo_core: ContractAddress = 0x00000005dd3d2f4429af886cd1a3b08289dbcea99a294197e9eb43b0e0325b4b.try_into().unwrap();

            let num_loops: u8 = 3;
            let mut remaining_wbtc = amount;
            let mut total_collateral: u256 = 0;
            let mut total_debt: u256 = 0;
            let mut i: u8 = 0;

            while i < num_loops {
                // Calculate USDC borrow at 50% LTV
                // borrow_usdc(6-dec) = remaining_wbtc(8-dec) * wbtc_price * 50 / (usdc_price * 10000)
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

                // Swap USDC → WBTC via AVNU with hardcoded Ekubo USDC/WBTC route
                let usdc_balance = usdc.balance_of(this);
                usdc.approve(avnu_addr, usdc_balance);

                // min WBTC out with 5% slippage tolerance
                // min_wbtc(8-dec) = usdc_bal(6-dec) * usdc_price * 95 / wbtc_price
                let min_wbtc_out = (usdc_balance * usdc_price.value * 95) / wbtc_price.value;

                // Ekubo pool key: token0 < token1 by address value
                let wbtc_felt: felt252 = wbtc_addr.into();
                let debt_felt: felt252 = debt_addr.into();
                let wbtc_val: u256 = wbtc_felt.into();
                let debt_val_u: u256 = debt_felt.into();
                let (token0, token1) = if wbtc_val < debt_val_u {
                    (wbtc_felt, debt_felt)
                } else {
                    (debt_felt, wbtc_felt)
                };
                let swap_params: Array<felt252> = array![
                    token0,                                 // token0 (lower address)
                    token1,                                 // token1 (higher address)
                    0x20c49ba5e353f80000000000000000,       // fee 0.05%
                    0x3e8,                                  // tick_spacing 1000
                    0x0,                                    // extension
                    0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF,     // sqrt_ratio_distance (max)
                ];
                let routes = array![Route {
                    token_from: debt_addr,
                    token_to: wbtc_addr,
                    exchange_address: ekubo_core,
                    percent: 1000000000000,
                    additional_swap_params: swap_params.span(),
                }];

                avnu.multi_route_swap(
                    debt_addr, usdc_balance, wbtc_addr,
                    0, min_wbtc_out, this, 0, Zero::zero(), routes,
                );

                i += 1;
                remaining_wbtc = wbtc.balance_of(this);
                if remaining_wbtc < min_deposit { break; }
            };

            // Deposit leftover WBTC as final collateral (no borrow)
            let leftover = wbtc.balance_of(this);
            if leftover > 0 && leftover >= min_deposit {
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

            self.total_collateral_deposited.write(self.total_collateral_deposited.read() + total_collateral);
            self.total_debt_borrowed.write(self.total_debt_borrowed.read() + total_debt);
            self.leverage_loops.write(self.leverage_loops.read() + i);

            self._refresh_total_assets();
        }

        /// Auto-unwind: if idle WBTC < needed, flash-loan unwind the entire Vesu position
        /// using hardcoded Ekubo WBTC/USDC route (same pool as _deploy_to_strategy).
        fn _ensure_idle_balance(ref self: ContractState, needed: u256) {
            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };
            let idle = wbtc.balance_of(this);

            if idle >= needed {
                return;
            }

            // Check if there's a Vesu position to unwind
            let debt_addr = self.debt_asset.read();
            let pool_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: pool_addr };
            let (_pos, _coll_val, debt_val) = vesu.position(wbtc_addr, debt_addr, this);

            if debt_val == 0 {
                return; // No leveraged position, nothing to unwind
            }

            // Calculate wbtc_to_sell from oracle prices with 5% buffer
            // debt_val is 6-dec (USDC), wbtc_to_sell is 8-dec (sats): *100 for decimal conversion
            let wbtc_price = vesu.price(wbtc_addr);
            let usdc_price = vesu.price(debt_addr);
            assert(wbtc_price.value > 0 && usdc_price.value > 0, 'Invalid oracle prices');
            let debt_in_wbtc = (debt_val * usdc_price.value * 100) / wbtc_price.value;
            let wbtc_to_sell = (debt_in_wbtc * 105) / 100;
            let min_usdc_out = debt_val; // Must at least cover flash loan repayment

            // Build hardcoded Ekubo WBTC/USDC route (same as _deploy_to_strategy)
            let ekubo_core: ContractAddress = 0x00000005dd3d2f4429af886cd1a3b08289dbcea99a294197e9eb43b0e0325b4b.try_into().unwrap();
            let wbtc_felt: felt252 = wbtc_addr.into();
            let debt_felt: felt252 = debt_addr.into();
            let wbtc_val: u256 = wbtc_felt.into();
            let debt_val_u: u256 = debt_felt.into();
            let (token0, token1) = if wbtc_val < debt_val_u {
                (wbtc_felt, debt_felt)
            } else {
                (debt_felt, wbtc_felt)
            };
            let swap_params: Array<felt252> = array![
                token0, token1,
                0x20c49ba5e353f80000000000000000, // fee 0.05%
                0x3e8,                             // tick_spacing 1000
                0x0,                               // extension
                0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF, // sqrt_ratio_distance (max)
            ];
            let routes: Array<Route> = array![Route {
                token_from: wbtc_addr,
                token_to: debt_addr,
                exchange_address: ekubo_core,
                percent: 1000000000000,
                additional_swap_params: swap_params.span(),
            }];

            // Serialize flash loan callback data (same format as flash_unwind)
            let mut data: Array<felt252> = array![];
            wbtc_to_sell.serialize(ref data);
            min_usdc_out.serialize(ref data);
            routes.serialize(ref data);

            // Flash loan USDC debt amount → on_flash_loan handles repay + swap
            vesu.flash_loan(this, debt_addr, debt_val, false, data.span());

            self._refresh_total_assets();
        }
    }
}

// ── External Trait Definitions ──────────────────────────────────────────

use btcvault::interfaces::Route;

#[starknet::interface]
pub trait ICurator<TContractState> {
    fn deploy_to_vesu(ref self: TContractState, amount: u256);
    fn withdraw_from_vesu(ref self: TContractState, amount: u256);
    fn execute_leverage_loop(
        ref self: TContractState,
        collateral_amount: u256,
        borrow_amount: u256,
        min_swap_out: u256,
        routes: Array<Route>,
    );
    fn deleverage(ref self: TContractState, repay_amount: u256, withdraw_collateral: u256);
    fn flash_unwind(ref self: TContractState, wbtc_to_sell: u256, min_usdc_out: u256, routes: Array<Route>);
    fn harvest(ref self: TContractState);
    fn upgrade(ref self: TContractState, new_class_hash: starknet::ClassHash);
    fn pause(ref self: TContractState);
    fn unpause(ref self: TContractState);
    fn transfer_ownership(ref self: TContractState, new_owner: starknet::ContractAddress);
    fn accept_ownership(ref self: TContractState);
    fn set_vesu_pool(ref self: TContractState, pool_id: felt252);
    fn set_debt_asset(ref self: TContractState, debt_asset: starknet::ContractAddress);
}

#[starknet::interface]
pub trait IVaultView<TContractState> {
    fn get_owner(self: @TContractState) -> starknet::ContractAddress;
    fn get_strategy_info(self: @TContractState) -> (u256, u256, u8, bool);
    fn get_vesu_pool_id(self: @TContractState) -> felt252;
    fn get_avnu_exchange(self: @TContractState) -> starknet::ContractAddress;
    fn get_debt_asset(self: @TContractState) -> starknet::ContractAddress;
    fn min_deposit(self: @TContractState) -> u256;
}
