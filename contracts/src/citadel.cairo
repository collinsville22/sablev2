/// BTCVault Citadel — Endur xWBTC Staking + Vesu Supply
///
/// WBTC → Endur ERC-4626 vault → xWBTC (liquid staking) → supply xWBTC to Vesu as collateral.
/// Earns Endur staking yield + Vesu BTCFi rewards.

#[starknet::contract]
pub mod BTCVaultCitadel {
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
        endur_vault: ContractAddress,     // Endur xWBTC ERC-4626 vault
        vesu_singleton: ContractAddress,
        vesu_pool_id: felt252,
        // Strategy state
        xwbtc_staked: u256,               // xWBTC shares held from Endur
        vesu_collateral: u256,            // xWBTC supplied to Vesu
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
        EndurStake: EndurStake,
        EndurUnstake: EndurUnstake,
        VesuDeposit: VesuDeposit,
        VesuWithdraw: VesuWithdraw,
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
    pub struct EndurStake { pub wbtc_in: u256, pub xwbtc_out: u256 }
    #[derive(Drop, starknet::Event)]
    pub struct EndurUnstake { pub xwbtc_in: u256, pub wbtc_out: u256 }
    #[derive(Drop, starknet::Event)]
    pub struct VesuDeposit { pub xwbtc_amount: u256 }
    #[derive(Drop, starknet::Event)]
    pub struct VesuWithdraw { pub xwbtc_amount: u256 }
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
        self.name.write("BTCVault Citadel");
        self.symbol.write("yvBTC-CIT");
        self.asset.write(asset);
        self.owner.write(owner);
        self.endur_vault.write(endur_vault);
        self.vesu_singleton.write(vesu_singleton);
        self.vesu_pool_id.write(vesu_pool_id);
        self.total_supply.write(0);
        self.total_assets_managed.write(0);
        self.xwbtc_staked.write(0);
        self.vesu_collateral.write(0);
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

            // If user is withdrawing/redeeming their entire balance, burn all shares (prevents dust)
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

            // If user is withdrawing/redeeming their entire balance, burn all shares (prevents dust)
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
    impl CuratorImpl of super::ICitadelCurator<ContractState> {
        /// Stake WBTC → Endur → xWBTC via ERC-4626 deposit
        fn stake_to_endur(ref self: ContractState, amount: u256) {
            self._assert_owner();
            assert(amount > 0, 'Vault: zero amount');
            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let endur_addr = self.endur_vault.read();

            // Approve Endur vault to spend WBTC
            let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };
            wbtc.approve(endur_addr, amount);

            // Deposit WBTC → receive xWBTC shares
            let endur = IERC4626Dispatcher { contract_address: endur_addr };
            let xwbtc_shares = endur.deposit(amount, this);

            self.xwbtc_staked.write(self.xwbtc_staked.read() + xwbtc_shares);
            self.emit(EndurStake { wbtc_in: amount, xwbtc_out: xwbtc_shares });
        }

        /// Supply xWBTC to Vesu as collateral
        fn deploy_xwbtc_to_vesu(ref self: ContractState, amount: u256) {
            self._assert_owner();
            assert(amount > 0, 'Vault: zero amount');
            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let endur_addr = self.endur_vault.read();
            let pool_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: pool_addr };

            // Approve Vesu pool to spend xWBTC
            let xwbtc = IERC20Dispatcher { contract_address: endur_addr };
            xwbtc.approve(pool_addr, amount);

            // Supply xWBTC as collateral (no debt)
            // debt_asset must be a valid registered asset even with 0 debt
            let params = ModifyPositionParams {
                collateral_asset: endur_addr,
                debt_asset: wbtc_addr,
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
            self.vesu_collateral.write(self.vesu_collateral.read() + amount);
            self.emit(VesuDeposit { xwbtc_amount: amount });
        }

        /// Withdraw xWBTC from Vesu
        fn withdraw_from_vesu(ref self: ContractState, amount: u256) {
            self._assert_owner();
            assert(amount > 0, 'Vault: zero amount');
            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let endur_addr = self.endur_vault.read();
            let pool_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: pool_addr };

            let params = ModifyPositionParams {
                collateral_asset: endur_addr,
                debt_asset: wbtc_addr,
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
            let prev = self.vesu_collateral.read();
            if amount <= prev { self.vesu_collateral.write(prev - amount); }
            else { self.vesu_collateral.write(0); }
            self.emit(VesuWithdraw { xwbtc_amount: amount });
        }

        /// Unstake xWBTC → WBTC via Endur ERC-4626 redeem
        fn unstake_from_endur(ref self: ContractState, shares: u256) {
            self._assert_owner();
            assert(shares > 0, 'Vault: zero shares');
            let this = get_contract_address();
            let endur = IERC4626Dispatcher { contract_address: self.endur_vault.read() };
            let wbtc_out = endur.redeem(shares, this, this);

            let prev = self.xwbtc_staked.read();
            if shares <= prev { self.xwbtc_staked.write(prev - shares); }
            else { self.xwbtc_staked.write(0); }
            self.emit(EndurUnstake { xwbtc_in: shares, wbtc_out });
        }

        /// Atomically unwind ALL xWBTC positions: withdraw from Vesu + swap xWBTC -> WBTC via AVNU.
        /// Endur xWBTC has a 7-day withdrawal queue, so we swap via AVNU instead.
        /// Curator must provide fresh AVNU routes from the API.
        fn unwind_xwbtc(ref self: ContractState, min_amount_out: u256, routes: Array<Route>) {
            self._assert_owner();

            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let endur_addr = self.endur_vault.read();
            let pool_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: pool_addr };

            // Step 1: Withdraw ALL xWBTC from Vesu (no debt, so simple)
            let (pos, _coll_val, _) = vesu.position(endur_addr, wbtc_addr, this);
            if pos.collateral_shares > 0 {
                vesu.modify_position(ModifyPositionParams {
                    collateral_asset: endur_addr,
                    debt_asset: wbtc_addr,
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
            }

            // Step 2: Swap ALL xWBTC -> WBTC via AVNU
            let xwbtc_token = IERC20Dispatcher { contract_address: endur_addr };
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

            // Zero out storage — all xWBTC converted to idle WBTC
            self.xwbtc_staked.write(0);
            self.vesu_collateral.write(0);
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
    }

    // ── View Functions ──────────────────────────────────────────────────

    #[abi(embed_v0)]
    impl VaultViewImpl of super::ICitadelView<ContractState> {
        fn get_owner(self: @ContractState) -> ContractAddress { self.owner.read() }
        fn get_strategy_info(self: @ContractState) -> (u256, u256, u8, bool) {
            (self.vesu_collateral.read(), 0, 0, self.is_paused.read())
        }
        fn get_endur_staked(self: @ContractState) -> u256 { self.xwbtc_staked.read() }
        fn min_deposit(self: @ContractState) -> u256 {
            self._vesu_xwbtc_dust_min()
        }
    }

    // ── Internal Helpers ────────────────────────────────────────────────

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _assert_owner(self: @ContractState) { assert(get_caller_address() == self.owner.read(), 'Caller is not owner'); }

        /// Returns assets available for withdrawal: idle WBTC + xWBTC value (converted to WBTC).
        fn _available_assets(self: @ContractState) -> u256 {
            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let endur_addr = self.endur_vault.read();
            let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };
            let idle = wbtc.balance_of(this);

            let endur = IERC4626Dispatcher { contract_address: endur_addr };

            // xWBTC in Vesu as collateral
            let pool_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: pool_addr };
            let (_pos, vesu_coll_val, _) = vesu.position(endur_addr, wbtc_addr, this);
            let vesu_wbtc = if vesu_coll_val > 0 { endur.convert_to_assets(vesu_coll_val) } else { 0 };

            // Idle xWBTC not in Vesu
            let xwbtc_token = IERC20Dispatcher { contract_address: endur_addr };
            let idle_xwbtc = xwbtc_token.balance_of(this);
            let idle_xwbtc_value = if idle_xwbtc > 0 { endur.convert_to_assets(idle_xwbtc) } else { 0 };

            idle + vesu_wbtc + idle_xwbtc_value
        }

        /// Vesu dust minimum for xWBTC collateral: floor * scale / price + 1,
        /// converted back to WBTC equivalent.
        fn _vesu_xwbtc_dust_min(self: @ContractState) -> u256 {
            let endur_addr = self.endur_vault.read();
            let pool_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: pool_addr };
            let config = vesu.asset_config(endur_addr);
            let price = vesu.price(endur_addr);
            if price.value > 0 && config.floor > 0 {
                let min_xwbtc = (config.floor * config.scale) / price.value + 1;
                let endur = IERC4626Dispatcher { contract_address: endur_addr };
                endur.convert_to_assets(min_xwbtc)
            } else {
                0
            }
        }

        fn _refresh_total_assets(ref self: ContractState) {
            let this = get_contract_address();
            let endur_addr = self.endur_vault.read();
            let wbtc_addr = self.asset.read();
            let endur = IERC4626Dispatcher { contract_address: endur_addr };
            let total_xwbtc = self.xwbtc_staked.read();
            let endur_value = if total_xwbtc > 0 { endur.convert_to_assets(total_xwbtc) } else { 0 };
            let pool_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: pool_addr };
            let (_pos, vesu_collateral_value, _debt) = vesu.position(endur_addr, wbtc_addr, this);
            let vesu_wbtc_value = if vesu_collateral_value > 0 { endur.convert_to_assets(vesu_collateral_value) } else { 0 };
            let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };
            let idle = wbtc.balance_of(this);
            self.total_assets_managed.write(endur_value + vesu_wbtc_value + idle);
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
            let wbtc_addr = self.asset.read();
            let endur_addr = self.endur_vault.read();
            let pool_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: pool_addr };

            let min_deposit = self._vesu_xwbtc_dust_min();
            assert(amount >= min_deposit, 'Deposit below minimum');

            // Step 1: Stake WBTC → Endur → xWBTC
            let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };
            wbtc.approve(endur_addr, amount);
            let endur = IERC4626Dispatcher { contract_address: endur_addr };
            let xwbtc_shares = endur.deposit(amount, this);
            self.xwbtc_staked.write(self.xwbtc_staked.read() + xwbtc_shares);
            self.emit(EndurStake { wbtc_in: amount, xwbtc_out: xwbtc_shares });

            // Step 2: Supply xWBTC to Vesu as collateral
            // debt_asset must be a valid registered asset (WBTC) even with 0 debt
            let xwbtc = IERC20Dispatcher { contract_address: endur_addr };
            xwbtc.approve(pool_addr, xwbtc_shares);
            let params = ModifyPositionParams {
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
            };
            vesu.modify_position(params);
            self.vesu_collateral.write(self.vesu_collateral.read() + xwbtc_shares);
            self.emit(VesuDeposit { xwbtc_amount: xwbtc_shares });
        }

        /// Auto-unwind: withdraw xWBTC from Vesu + swap xWBTC→WBTC via AVNU.
        fn _ensure_idle_balance(ref self: ContractState, needed: u256) {
            let this = get_contract_address();
            let wbtc_addr = self.asset.read();
            let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };
            let idle = wbtc.balance_of(this);
            if idle >= needed { return; }

            let endur_addr = self.endur_vault.read();
            let pool_addr: ContractAddress = self.vesu_pool_id.read().try_into().unwrap();
            let vesu = IVesuPoolDispatcher { contract_address: pool_addr };

            // Step 1: Withdraw ALL xWBTC from Vesu (no debt, so simple)
            let (pos, _coll_val, _) = vesu.position(endur_addr, wbtc_addr, this);
            if pos.collateral_shares == 0 { return; }

            vesu.modify_position(ModifyPositionParams {
                collateral_asset: endur_addr,
                debt_asset: wbtc_addr,
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

            // Step 2: Swap ALL xWBTC → WBTC via AVNU (hardcoded Ekubo route)
            let xwbtc_token = IERC20Dispatcher { contract_address: endur_addr };
            let xwbtc_balance = xwbtc_token.balance_of(this);
            if xwbtc_balance == 0 { return; }

            let avnu_addr: ContractAddress = AVNU_EXCHANGE.try_into().unwrap();
            xwbtc_token.approve(avnu_addr, xwbtc_balance);

            let wbtc_felt: felt252 = wbtc_addr.into();
            let endur_felt: felt252 = endur_addr.into();
            let ekubo_core: ContractAddress =
                0x00000005dd3d2f4429af886cd1a3b08289dbcea99a294197e9eb43b0e0325b4b
                .try_into().unwrap();
            // xWBTC/WBTC Ekubo pool: fee=0.01%, tick_spacing=200
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

            let avnu = IAvnuExchangeDispatcher { contract_address: avnu_addr };
            avnu.multi_route_swap(
                endur_addr, xwbtc_balance, wbtc_addr, 0, 0,
                this, 0, Zero::zero(), routes,
            );

            // Zero out storage
            self.xwbtc_staked.write(0);
            self.vesu_collateral.write(0);
            self._refresh_total_assets();
        }
    }
}

use btcvault::interfaces::Route;

#[starknet::interface]
pub trait ICitadelCurator<TContractState> {
    fn stake_to_endur(ref self: TContractState, amount: u256);
    fn deploy_xwbtc_to_vesu(ref self: TContractState, amount: u256);
    fn withdraw_from_vesu(ref self: TContractState, amount: u256);
    fn unstake_from_endur(ref self: TContractState, shares: u256);
    fn unwind_xwbtc(ref self: TContractState, min_amount_out: u256, routes: Array<Route>);
    fn harvest(ref self: TContractState);
    fn upgrade(ref self: TContractState, new_class_hash: starknet::ClassHash);
    fn pause(ref self: TContractState);
    fn unpause(ref self: TContractState);
    fn transfer_ownership(ref self: TContractState, new_owner: starknet::ContractAddress);
    fn accept_ownership(ref self: TContractState);
    fn set_vesu_pool(ref self: TContractState, pool_id: felt252);
}

#[starknet::interface]
pub trait ICitadelView<TContractState> {
    fn get_owner(self: @TContractState) -> starknet::ContractAddress;
    fn get_strategy_info(self: @TContractState) -> (u256, u256, u8, bool);
    fn get_endur_staked(self: @TContractState) -> u256;
    fn min_deposit(self: @TContractState) -> u256;
}
