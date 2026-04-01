/// BTCVault Trident — Looped Endur Staking (Endur + Vesu recursive)
///
/// WBTC → Endur → xWBTC → Vesu supply xWBTC → borrow WBTC → Endur again → repeat.
/// Each loop amplifies Endur staking yield. xWBTC/WBTC ratio appreciates naturally.

#[starknet::contract]
pub mod BTCVaultTrident {
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use starknet::ClassHash;
    use starknet::SyscallResultTrait;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess, StorageMapReadAccess, StorageMapWriteAccess};
    use core::num::traits::Zero;

    use btcvault::interfaces::{
        IERC20Dispatcher, IERC20DispatcherTrait,
        IERC4626Dispatcher, IERC4626DispatcherTrait,
        IVesuPoolDispatcher, IVesuPoolDispatcherTrait,
        IAvnuExchangeDispatcher, IAvnuExchangeDispatcherTrait, Route,
        ModifyPositionParams, Amount, AmountDenomination, i257,
        VESU_SINGLETON,
    };

    const AVNU_EXCHANGE: felt252 = 0x04270219d365d6b017231b52e92b3fb5d7c8378b05e9abc97724537a80e93b0f;

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
        // Strategy state
        xwbtc_staked: u256,
        vesu_collateral: u256,
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
        StakingLoop: StakingLoop,
        Deleverage: Deleverage,
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
    pub struct StakingLoop { pub wbtc_initial: u256, pub total_xwbtc_staked: u256, pub total_wbtc_borrowed: u256, pub loops: u8 }
    #[derive(Drop, starknet::Event)]
    pub struct Deleverage { pub debt_repaid: u256, pub collateral_withdrawn: u256 }
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
    ) {
        self.name.write("BTCVault Trident");
        self.symbol.write("yvBTC-TRI");
        self.asset.write(asset);
        self.owner.write(owner);
        self.endur_vault.write(endur_vault);
        self.vesu_singleton.write(vesu_singleton);
        self.vesu_pool_id.write(vesu_pool_id);
        self.total_supply.write(0);
        self.total_assets_managed.write(0);
        self.xwbtc_staked.write(0);
        self.vesu_collateral.write(0);
        self.total_debt_borrowed.write(0);
        self.leverage_loops.write(0);
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

            // Tolerance: iterative deleverage has conversion/rounding losses.
            let transfer_amount = if actual_balance >= assets {
                assets
            } else {
                let shortfall = assets - actual_balance;
                let tolerance = assets / 200; // 0.5%
                assert(shortfall <= tolerance, 'Insufficient liquidity');
                actual_balance
            };

            if caller != owner {
                let a = self.allowances.read((owner, caller));
                self.allowances.write((owner, caller), a - shares);
            }
            self._burn(owner, shares);

            let current_managed = self.total_assets_managed.read();
            if transfer_amount <= current_managed {
                self.total_assets_managed.write(current_managed - transfer_amount);
            } else {
                self.total_assets_managed.write(0);
            }

            wbtc.transfer(receiver, transfer_amount);
            self.emit(WithdrawEvent { sender: caller, receiver, owner, assets: transfer_amount, shares });
            shares
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

            // Tolerance: iterative deleverage has conversion/rounding losses.
            // If shortfall is tiny (< 0.5% of requested), transfer what's available.
            let transfer_amount = if actual_balance >= assets {
                assets
            } else {
                let shortfall = assets - actual_balance;
                let tolerance = assets / 200; // 0.5%
                assert(shortfall <= tolerance, 'Insufficient liquidity');
                actual_balance
            };

            if caller != owner {
                let a = self.allowances.read((owner, caller));
                self.allowances.write((owner, caller), a - shares);
            }
            self._burn(owner, shares);

            let current_managed = self.total_assets_managed.read();
            if transfer_amount <= current_managed {
                self.total_assets_managed.write(current_managed - transfer_amount);
            } else {
                self.total_assets_managed.write(0);
            }

            wbtc.transfer(receiver, transfer_amount);
            self.emit(WithdrawEvent { sender: caller, receiver, owner, assets: transfer_amount, shares });
            transfer_amount
        }
    }

    // ── Flash Loan Receiver ─────────────────────────────────────────────

    #[abi(embed_v0)]
    impl FlashloanReceiverImpl of btcvault::interfaces::IFlashloanReceiver<ContractState> {
        /// Called by Vesu pool during flash_loan. Executes the full unwind:
        /// 1. Repay ALL debt  2. Withdraw ALL xWBTC collateral  3. Swap xWBTC→WBTC via AVNU
        fn on_flash_loan(
            ref self: ContractState,
            sender: ContractAddress,
            asset: ContractAddress,
            amount: u256,
            data: Span<felt252>,
        ) {
            let this = get_contract_address();
            let pool_id = self.vesu_pool_id.read();
            let vesu_addr: ContractAddress = pool_id.try_into().unwrap();

            // Security: only the Vesu pool can call this, and only we can initiate it
            assert(get_caller_address() == vesu_addr, 'Only pool can callback');
            assert(sender == this, 'Only self can initiate');

            let wbtc_addr = self.asset.read();
            let endur_addr = self.endur_vault.read();
            let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };
            let xwbtc_token = IERC20Dispatcher { contract_address: endur_addr };
            let vesu = IVesuPoolDispatcher { contract_address: vesu_addr };
            let singleton_addr: ContractAddress = VESU_SINGLETON.try_into().unwrap();

            // Deserialize min_amount_out and routes from callback data
            let mut data_span = data;
            let min_amount_out: u256 = Serde::deserialize(ref data_span).expect('bad min_amount');
            let routes: Array<Route> = Serde::deserialize(ref data_span).expect('bad routes');

            // Step 1: Repay ALL debt and withdraw ALL collateral atomically
            let (pos, _coll_val, debt_val) = vesu.position(endur_addr, wbtc_addr, this);

            let approve_buf = debt_val + debt_val / 50 + 100;
            wbtc.approve(vesu_addr, approve_buf);
            wbtc.approve(singleton_addr, approve_buf);

            vesu.modify_position(ModifyPositionParams {
                collateral_asset: endur_addr, debt_asset: wbtc_addr, user: this,
                collateral: Amount {
                    denomination: AmountDenomination::Native,
                    value: i257 { abs: pos.collateral_shares, is_negative: true },
                },
                debt: Amount {
                    denomination: AmountDenomination::Assets,
                    value: i257 { abs: debt_val, is_negative: true },
                },
            });

            // Step 2: Swap ALL xWBTC → WBTC via AVNU using curator-provided routes
            let xwbtc_balance = xwbtc_token.balance_of(this);
            assert(xwbtc_balance > 0, 'No xWBTC to swap');

            let avnu_addr: ContractAddress = AVNU_EXCHANGE.try_into().unwrap();
            xwbtc_token.approve(avnu_addr, xwbtc_balance);

            let avnu = IAvnuExchangeDispatcher { contract_address: avnu_addr };

            avnu.multi_route_swap(
                endur_addr,        // token_from: xWBTC
                xwbtc_balance,     // amount: all xWBTC
                wbtc_addr,         // token_to: WBTC
                0,                 // token_to_amount: not used
                min_amount_out,    // min output: slippage protection
                this,              // beneficiary: vault
                0,                 // integrator_fee: 0
                Zero::zero(),      // fee_recipient: none
                routes,            // routes from curator
            );

            // Step 3: Approve pool to pull flash loan repayment (Vesu zero-fee flash loan)
            wbtc.approve(vesu_addr, amount);

            // Update storage — position is fully closed
            self.xwbtc_staked.write(0);
            self.vesu_collateral.write(0);
            self.total_debt_borrowed.write(0);
            self.leverage_loops.write(0);
        }
    }

    // ── Curator Functions ───────────────────────────────────────────────

    #[abi(embed_v0)]
    impl CuratorImpl of super::ITridentCurator<ContractState> {
        /// Execute recursive staking loop:
        /// For each loop: WBTC -> Endur -> xWBTC -> Vesu supply -> borrow WBTC -> repeat
        fn execute_staking_loop(ref self: ContractState, wbtc_amount: u256, num_loops: u8) {
            self._assert_owner();
            assert(wbtc_amount > 0, 'Vault: zero amount');
            assert(num_loops > 0, 'Vault: zero loops');

            let min_deposit = self._min_deposit_for_loops(num_loops);
            assert(wbtc_amount >= min_deposit, 'Amount below minimum');

            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let endur_addr = self.endur_vault.read();
            let pool_id = self.vesu_pool_id.read();
            let vesu_addr: ContractAddress = pool_id.try_into().unwrap();

            let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };
            let endur = IERC4626Dispatcher { contract_address: endur_addr };
            let xwbtc_token = IERC20Dispatcher { contract_address: endur_addr };
            let vesu = IVesuPoolDispatcher { contract_address: vesu_addr };

            let mut remaining_wbtc = wbtc_amount;
            let mut total_xwbtc_added: u256 = 0;
            let mut total_wbtc_borrowed: u256 = 0;
            let mut i: u8 = 0;

            while i < num_loops {
                // 1. Stake WBTC -> Endur -> xWBTC
                wbtc.approve(endur_addr, remaining_wbtc);
                let xwbtc_shares = endur.deposit(remaining_wbtc, this);
                total_xwbtc_added += xwbtc_shares;

                // 2. Supply xWBTC to Vesu as collateral
                xwbtc_token.approve(vesu_addr, xwbtc_shares);
                vesu.modify_position(ModifyPositionParams {
                    collateral_asset: endur_addr,
                    debt_asset: wbtc_addr,
                    user: this,
                    collateral: Amount {
                        denomination: AmountDenomination::Assets,
                        value: i257 { abs: xwbtc_shares, is_negative: false },
                    },
                    debt: Amount {
                        denomination: AmountDenomination::Assets,
                        value: i257 { abs: 0, is_negative: false },
                    },
                });

                // 3. Borrow WBTC from Vesu (70% LTV)
                let borrow_amount = (remaining_wbtc * 70) / 100;
                if borrow_amount == 0 { break; }

                vesu.modify_position(ModifyPositionParams {
                    collateral_asset: endur_addr,
                    debt_asset: wbtc_addr,
                    user: this,
                    collateral: Amount {
                        denomination: AmountDenomination::Assets,
                        value: i257 { abs: 0, is_negative: false },
                    },
                    debt: Amount {
                        denomination: AmountDenomination::Assets,
                        value: i257 { abs: borrow_amount, is_negative: false },
                    },
                });
                total_wbtc_borrowed += borrow_amount;

                // 4. Use borrowed WBTC for next loop
                remaining_wbtc = borrow_amount;
                i += 1;
            };

            // Update state
            self.xwbtc_staked.write(self.xwbtc_staked.read() + total_xwbtc_added);
            self.vesu_collateral.write(self.vesu_collateral.read() + total_xwbtc_added);
            self.total_debt_borrowed.write(self.total_debt_borrowed.read() + total_wbtc_borrowed);
            self.leverage_loops.write(self.leverage_loops.read() + num_loops);

            self.emit(StakingLoop {
                wbtc_initial: wbtc_amount,
                total_xwbtc_staked: total_xwbtc_added,
                total_wbtc_borrowed,
                loops: num_loops,
            });
        }

        /// Deleverage: repay debt -> withdraw xWBTC -> unstake -> repeat
        fn deleverage(ref self: ContractState, loops_to_unwind: u8) {
            self._assert_owner();
            assert(loops_to_unwind > 0, 'Vault: zero loops');

            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let endur_addr = self.endur_vault.read();
            let pool_id = self.vesu_pool_id.read();
            let vesu_addr: ContractAddress = pool_id.try_into().unwrap();

            let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };
            let endur = IERC4626Dispatcher { contract_address: endur_addr };
            let vesu = IVesuPoolDispatcher { contract_address: vesu_addr };
            let singleton_addr: ContractAddress = VESU_SINGLETON.try_into().unwrap();

            let mut total_debt_repaid: u256 = 0;
            let mut total_collateral_freed: u256 = 0;
            let mut i: u8 = 0;

            while i < loops_to_unwind {
                let (_pos, _coll_val, debt_val) = vesu.position(endur_addr, wbtc_addr, this);
                if debt_val == 0 { break; }

                let cur_idle = wbtc.balance_of(this);
                let repay_from_idle = if cur_idle > 100 {
                    let max_r = cur_idle - 100;
                    if max_r < debt_val { max_r } else { debt_val }
                } else { 0_u256 };

                if repay_from_idle == 0 { break; }

                // Step A: Repay debt only
                let approve_buf = repay_from_idle + repay_from_idle / 50 + 10;
                wbtc.approve(vesu_addr, approve_buf);
                wbtc.approve(singleton_addr, approve_buf);
                vesu.modify_position(ModifyPositionParams {
                    collateral_asset: endur_addr, debt_asset: wbtc_addr, user: this,
                    collateral: Amount { denomination: AmountDenomination::Assets, value: i257 { abs: 0, is_negative: false } },
                    debt: Amount { denomination: AmountDenomination::Assets, value: i257 { abs: repay_from_idle, is_negative: true } },
                });
                total_debt_repaid += repay_from_idle;

                // Step B: Withdraw collateral separately (after debt reduced)
                let (pos2, coll_val2, debt_val2) = vesu.position(endur_addr, wbtc_addr, this);
                let min_coll = if debt_val2 > 0 { (debt_val2 * 150) / 100 } else { 0_u256 };
                let xwbtc_to_free = if coll_val2 > min_coll { coll_val2 - min_coll } else { 0_u256 };

                if xwbtc_to_free > 0 {
                    let shares_to_free = if xwbtc_to_free >= coll_val2 {
                        pos2.collateral_shares
                    } else if coll_val2 > 0 {
                        (pos2.collateral_shares * xwbtc_to_free) / coll_val2
                    } else { 0_u256 };

                    let xwbtc_token = IERC20Dispatcher { contract_address: endur_addr };
                    let xwbtc_before = xwbtc_token.balance_of(this);

                    vesu.modify_position(ModifyPositionParams {
                        collateral_asset: endur_addr, debt_asset: wbtc_addr, user: this,
                        collateral: Amount {
                            denomination: AmountDenomination::Native,
                            value: i257 { abs: shares_to_free, is_negative: true },
                        },
                        debt: Amount { denomination: AmountDenomination::Assets, value: i257 { abs: 0, is_negative: false } },
                    });

                    let xwbtc_after = xwbtc_token.balance_of(this);
                    let actual_xwbtc = xwbtc_after - xwbtc_before;
                    total_collateral_freed += actual_xwbtc;

                    // Unstake xWBTC -> WBTC (only if Endur has liquidity)
                    let endur_liquid = wbtc.balance_of(endur_addr);
                    let wbtc_received = if endur_liquid > 0 {
                        let safe_redeem = if actual_xwbtc < endur_liquid { actual_xwbtc } else { endur_liquid };
                        let wbtc_before_unstake = wbtc.balance_of(this);
                        endur.redeem(safe_redeem, this, this);
                        let wbtc_after_unstake = wbtc.balance_of(this);
                        if wbtc_after_unstake > wbtc_before_unstake {
                            wbtc_after_unstake - wbtc_before_unstake
                        } else { 0_u256 }
                    } else { 0_u256 };

                    // Repay more debt with freed WBTC
                    if wbtc_received > 100 {
                        let (_p3, _c3, remaining_debt) = vesu.position(endur_addr, wbtc_addr, this);
                        if remaining_debt > 0 {
                            let cur_wbtc = wbtc.balance_of(this);
                            let safe_repay = if cur_wbtc > 200 { cur_wbtc - 200 } else { 0_u256 };
                            let repay2 = if safe_repay < remaining_debt { safe_repay } else { remaining_debt };
                            if repay2 > 0 {
                                let approve_buf2 = repay2 + repay2 / 50 + 10;
                                wbtc.approve(vesu_addr, approve_buf2);
                                wbtc.approve(singleton_addr, approve_buf2);
                                vesu.modify_position(ModifyPositionParams {
                                    collateral_asset: endur_addr, debt_asset: wbtc_addr, user: this,
                                    collateral: Amount { denomination: AmountDenomination::Assets, value: i257 { abs: 0, is_negative: false } },
                                    debt: Amount { denomination: AmountDenomination::Assets, value: i257 { abs: repay2, is_negative: true } },
                                });
                                total_debt_repaid += repay2;
                            }
                        }
                    }
                }

                i += 1;
            };

            // Update state
            let prev_xwbtc = self.xwbtc_staked.read();
            if total_collateral_freed <= prev_xwbtc { self.xwbtc_staked.write(prev_xwbtc - total_collateral_freed); }
            else { self.xwbtc_staked.write(0); }

            let prev_coll = self.vesu_collateral.read();
            if total_collateral_freed <= prev_coll { self.vesu_collateral.write(prev_coll - total_collateral_freed); }
            else { self.vesu_collateral.write(0); }

            let prev_debt = self.total_debt_borrowed.read();
            if total_debt_repaid <= prev_debt { self.total_debt_borrowed.write(prev_debt - total_debt_repaid); }
            else { self.total_debt_borrowed.write(0); }

            let prev_loops = self.leverage_loops.read();
            if loops_to_unwind <= prev_loops { self.leverage_loops.write(prev_loops - loops_to_unwind); }
            else { self.leverage_loops.write(0); }

            self.emit(Deleverage { debt_repaid: total_debt_repaid, collateral_withdrawn: total_collateral_freed });
        }

        /// Atomically unwind the entire leveraged position using a Vesu flash loan.
        /// 1. Flash loan WBTC to repay all debt
        /// 2. Withdraw all xWBTC collateral from Vesu
        /// 3. Swap xWBTC → WBTC via AVNU (Ekubo) with slippage protection
        /// 4. Repay flash loan from swap proceeds
        /// Remaining WBTC becomes idle, available for user withdrawals.
        fn flash_unwind(ref self: ContractState, min_amount_out: u256, routes: Array<Route>) {
            self._assert_owner();

            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let endur_addr = self.endur_vault.read();
            let vesu_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: vesu_addr };

            let (_pos, _coll_val, debt_val) = vesu.position(endur_addr, wbtc_addr, this);
            assert(debt_val > 0, 'No debt to unwind');

            // Serialize min_amount_out and routes into flash loan callback data
            let mut data: Array<felt252> = array![];
            min_amount_out.serialize(ref data);
            routes.serialize(ref data);

            // Flash loan the full debt — on_flash_loan callback handles the unwind
            vesu.flash_loan(this, wbtc_addr, debt_val, false, data.span());

            // Refresh total assets after position is fully closed
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
    }

    // ── View Functions ──────────────────────────────────────────────────

    #[abi(embed_v0)]
    impl VaultViewImpl of super::ITridentView<ContractState> {
        fn get_owner(self: @ContractState) -> ContractAddress { self.owner.read() }
        fn get_strategy_info(self: @ContractState) -> (u256, u256, u8, bool) {
            (self.vesu_collateral.read(), self.total_debt_borrowed.read(), self.leverage_loops.read(), self.is_paused.read())
        }
        fn min_deposit(self: @ContractState) -> u256 {
            self._min_deposit_for_loops(3)
        }
    }

    // ── Internal Helpers ────────────────────────────────────────────────

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _assert_owner(self: @ContractState) { assert(get_caller_address() == self.owner.read(), 'Caller is not owner'); }

        /// Returns assets available for withdrawal: idle + freeable from Vesu.
        fn _available_assets(self: @ContractState) -> u256 {
            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let endur_addr = self.endur_vault.read();
            let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };
            let idle = wbtc.balance_of(this);

            let pool_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: pool_addr };
            let endur = IERC4626Dispatcher { contract_address: endur_addr };
            let (_pos, coll_val, debt_val) = vesu.position(endur_addr, wbtc_addr, this);

            if debt_val > 0 && coll_val > 0 {
                let xp = vesu.price(endur_addr);
                let wp = vesu.price(wbtc_addr);
                if xp.value > 0 && wp.value > 0 {
                    if debt_val * wp.value * 100 > coll_val * xp.value * 69 {
                        return idle;
                    }
                }
            }

            let coll_wbtc = if coll_val > 0 { endur.convert_to_assets(coll_val) } else { 0 };
            let net_vesu = if coll_wbtc > debt_val { coll_wbtc - debt_val } else { 0 };

            let xwbtc_token = IERC20Dispatcher { contract_address: endur_addr };
            let idle_xwbtc = xwbtc_token.balance_of(this);
            let idle_xwbtc_value = if idle_xwbtc > 0 { endur.convert_to_assets(idle_xwbtc) } else { 0 };

            idle + net_vesu + idle_xwbtc_value
        }

        /// Refresh total_assets_managed from on-chain state
        fn _refresh_total_assets(ref self: ContractState) {
            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let endur_addr = self.endur_vault.read();

            let endur = IERC4626Dispatcher { contract_address: endur_addr };
            let pool_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: pool_addr };

            let (_pos, collateral_xwbtc, debt_wbtc) = vesu.position(endur_addr, wbtc_addr, this);
            let collateral_wbtc_value = if collateral_xwbtc > 0 {
                endur.convert_to_assets(collateral_xwbtc)
            } else { 0 };

            let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };
            let idle_wbtc = wbtc.balance_of(this);

            let xwbtc_token = IERC20Dispatcher { contract_address: endur_addr };
            let idle_xwbtc = xwbtc_token.balance_of(this);
            let idle_xwbtc_value = if idle_xwbtc > 0 {
                endur.convert_to_assets(idle_xwbtc)
            } else { 0 };

            let total_value = collateral_wbtc_value + idle_wbtc + idle_xwbtc_value;
            let net = if total_value > debt_wbtc {
                total_value - debt_wbtc
            } else { 0 };

            self.total_assets_managed.write(net);
            self.vesu_collateral.write(collateral_xwbtc);
            self.total_debt_borrowed.write(debt_wbtc);
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

        /// Vesu debt dust minimum for WBTC: floor * scale / price + 1
        fn _vesu_debt_dust_min(self: @ContractState) -> u256 {
            let wbtc_addr = self.asset.read();
            let pool_id = self.vesu_pool_id.read();
            let vesu_addr: ContractAddress = pool_id.try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: vesu_addr };
            let config = vesu.asset_config(wbtc_addr);
            let price = vesu.price(wbtc_addr);
            if price.value > 0 && config.floor > 0 {
                (config.floor * config.scale) / price.value + 1
            } else {
                0
            }
        }

        /// Minimum WBTC deposit for N loops.
        /// Smallest borrow at loop N is amount * 0.7^N, must be >= debt dust min.
        /// Formula: ceil(min_debt * 10^N / 7^N)
        fn _min_deposit_for_loops(self: @ContractState, num_loops: u8) -> u256 {
            let min_debt = self._vesu_debt_dust_min();
            if min_debt == 0 { return 0; }

            let mut pow7: u256 = 1;
            let mut pow10: u256 = 1;
            let mut j: u8 = 0;
            while j < num_loops {
                pow7 = pow7 * 7;
                pow10 = pow10 * 10;
                j += 1;
            };

            (min_debt * pow10 + pow7 - 1) / pow7
        }

        /// Deploy deposited WBTC into 3-loop staking strategy
        fn _deploy_to_strategy(ref self: ContractState, amount: u256) {
            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let endur_addr = self.endur_vault.read();
            let pool_id = self.vesu_pool_id.read();
            let vesu_addr: ContractAddress = pool_id.try_into().unwrap();

            let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };
            let endur = IERC4626Dispatcher { contract_address: endur_addr };
            let xwbtc_token = IERC20Dispatcher { contract_address: endur_addr };
            let vesu = IVesuPoolDispatcher { contract_address: vesu_addr };

            let min_deposit = self._min_deposit_for_loops(3);
            assert(amount >= min_deposit, 'Deposit below minimum');

            let num_loops: u8 = 3;
            let mut remaining_wbtc = amount;
            let mut total_xwbtc_added: u256 = 0;
            let mut total_wbtc_borrowed: u256 = 0;
            let mut i: u8 = 0;

            while i < num_loops {
                wbtc.approve(endur_addr, remaining_wbtc);
                let xwbtc_shares = endur.deposit(remaining_wbtc, this);
                total_xwbtc_added += xwbtc_shares;

                xwbtc_token.approve(vesu_addr, xwbtc_shares);
                vesu.modify_position(ModifyPositionParams {
                    collateral_asset: endur_addr,
                    debt_asset: wbtc_addr,
                    user: this,
                    collateral: Amount {
                        denomination: AmountDenomination::Assets,
                        value: i257 { abs: xwbtc_shares, is_negative: false },
                    },
                    debt: Amount {
                        denomination: AmountDenomination::Assets,
                        value: i257 { abs: 0, is_negative: false },
                    },
                });

                let borrow_amount = (remaining_wbtc * 70) / 100;
                if borrow_amount == 0 { break; }

                vesu.modify_position(ModifyPositionParams {
                    collateral_asset: endur_addr,
                    debt_asset: wbtc_addr,
                    user: this,
                    collateral: Amount {
                        denomination: AmountDenomination::Assets,
                        value: i257 { abs: 0, is_negative: false },
                    },
                    debt: Amount {
                        denomination: AmountDenomination::Assets,
                        value: i257 { abs: borrow_amount, is_negative: false },
                    },
                });
                total_wbtc_borrowed += borrow_amount;

                remaining_wbtc = borrow_amount;
                i += 1;
            };

            self.xwbtc_staked.write(self.xwbtc_staked.read() + total_xwbtc_added);
            self.vesu_collateral.write(self.vesu_collateral.read() + total_xwbtc_added);
            self.total_debt_borrowed.write(self.total_debt_borrowed.read() + total_wbtc_borrowed);
            self.leverage_loops.write(self.leverage_loops.read() + num_loops);

            self.emit(StakingLoop {
                wbtc_initial: amount,
                total_xwbtc_staked: total_xwbtc_added,
                total_wbtc_borrowed,
                loops: num_loops,
            });
        }

        /// Auto-unwind: flash loan WBTC to repay debt, withdraw xWBTC, swap xWBTC→WBTC.
        fn _ensure_idle_balance(ref self: ContractState, needed: u256) {
            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };
            let idle = wbtc.balance_of(this);
            if idle >= needed { return; }

            let endur_addr = self.endur_vault.read();
            let vesu_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: vesu_addr };

            let (_pos, _coll_val, debt_val) = vesu.position(endur_addr, wbtc_addr, this);
            if _pos.collateral_shares == 0 { return; }

            // Build hardcoded Ekubo xWBTC/WBTC route for the on_flash_loan callback
            let wbtc_felt: felt252 = wbtc_addr.into();
            let endur_felt: felt252 = endur_addr.into();
            let ekubo_core: ContractAddress =
                0x00000005dd3d2f4429af886cd1a3b08289dbcea99a294197e9eb43b0e0325b4b
                .try_into().unwrap();
            let swap_params: Array<felt252> = array![
                wbtc_felt,    // token0 (WBTC < xWBTC by address)
                endur_felt,   // token1
                0x68db8bac710cb4000000000000000, // fee
                0xc8,         // tick_spacing = 200
                0x0,          // extension
                0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF, // sqrt_ratio_limit (max, selling token1 for token0)
            ];
            let routes: Array<Route> = array![Route {
                token_from: endur_addr,
                token_to: wbtc_addr,
                exchange_address: ekubo_core,
                percent: 1000000000000_u128,
                additional_swap_params: swap_params.span(),
            }];

            if debt_val == 0 {
                // No debt — just withdraw xWBTC collateral and swap
                vesu.modify_position(ModifyPositionParams {
                    collateral_asset: endur_addr,
                    debt_asset: wbtc_addr,
                    user: this,
                    collateral: Amount {
                        denomination: AmountDenomination::Native,
                        value: i257 { abs: _pos.collateral_shares, is_negative: true },
                    },
                    debt: Amount {
                        denomination: AmountDenomination::Assets,
                        value: i257 { abs: 0, is_negative: false },
                    },
                });

                let xwbtc_token = IERC20Dispatcher { contract_address: endur_addr };
                let xwbtc_balance = xwbtc_token.balance_of(this);
                if xwbtc_balance > 0 {
                    let avnu_addr: ContractAddress = AVNU_EXCHANGE.try_into().unwrap();
                    xwbtc_token.approve(avnu_addr, xwbtc_balance);
                    let avnu = IAvnuExchangeDispatcher { contract_address: avnu_addr };
                    avnu.multi_route_swap(
                        endur_addr, xwbtc_balance, wbtc_addr, 0, 0,
                        this, 0, Zero::zero(), routes,
                    );
                }

                self.xwbtc_staked.write(0);
                self.vesu_collateral.write(0);
                self.leverage_loops.write(0);
                self._refresh_total_assets();
                return;
            }

            // Has debt — flash loan to repay, then withdraw + swap in callback
            let min_amount_out: u256 = 0; // Must succeed (emergency unwind)
            let mut data: Array<felt252> = array![];
            min_amount_out.serialize(ref data);
            routes.serialize(ref data);

            vesu.flash_loan(this, wbtc_addr, debt_val, false, data.span());
            self._refresh_total_assets();
        }
    }
}

use btcvault::interfaces::Route;

#[starknet::interface]
pub trait ITridentCurator<TContractState> {
    fn execute_staking_loop(ref self: TContractState, wbtc_amount: u256, num_loops: u8);
    fn deleverage(ref self: TContractState, loops_to_unwind: u8);
    fn flash_unwind(ref self: TContractState, min_amount_out: u256, routes: Array<Route>);
    fn harvest(ref self: TContractState);
    fn upgrade(ref self: TContractState, new_class_hash: starknet::ClassHash);
    fn pause(ref self: TContractState);
    fn unpause(ref self: TContractState);
    fn transfer_ownership(ref self: TContractState, new_owner: starknet::ContractAddress);
    fn accept_ownership(ref self: TContractState);
}

#[starknet::interface]
pub trait ITridentView<TContractState> {
    fn get_owner(self: @TContractState) -> starknet::ContractAddress;
    fn get_strategy_info(self: @TContractState) -> (u256, u256, u8, bool);
    fn min_deposit(self: @TContractState) -> u256;
}
