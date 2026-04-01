/// BTCVault CDP — Borrow USDC Against WBTC Collateral
///
/// Per-user position manager wrapping Nostra lending protocol.
/// NOT an ERC-4626 vault. Users deposit WBTC as collateral, borrow USDC, manage position.

#[starknet::contract]
pub mod BTCVaultCDP {
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use starknet::ClassHash;
    use starknet::SyscallResultTrait;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess, StorageMapReadAccess, StorageMapWriteAccess};
    use core::num::traits::Zero;

    use btcvault::interfaces::{
        IERC20Dispatcher, IERC20DispatcherTrait,
        INostraCollateralTokenDispatcher, INostraCollateralTokenDispatcherTrait,
        INostraDebtTokenDispatcher, INostraDebtTokenDispatcherTrait,
        IPragmaOracleDispatcher, IPragmaOracleDispatcherTrait,
        DataType,
    };

    // ── Storage ─────────────────────────────────────────────────────────

    #[storage]
    struct Storage {
        wbtc: ContractAddress,
        usdc: ContractAddress,
        nostra_collateral_token: ContractAddress, // iWBTC-c
        nostra_debt_token: ContractAddress,       // dUSDC
        pragma_oracle: ContractAddress,
        owner: ContractAddress,
        pending_owner: ContractAddress,
        // Per-user position tracking
        user_wbtc_deposited: starknet::storage::Map<ContractAddress, u256>,
        user_usdc_borrowed: starknet::storage::Map<ContractAddress, u256>,
        // Global stats
        total_wbtc_collateral: u256,
        total_usdc_debt: u256,
        user_count: u32,
        // User existence tracking
        user_exists: starknet::storage::Map<ContractAddress, bool>,
        is_paused: bool,
    }

    // ── Events ──────────────────────────────────────────────────────────

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        DepositAndBorrow: DepositAndBorrow,
        RepayAndWithdraw: RepayAndWithdraw,
        OwnershipTransferred: OwnershipTransferred,
    }

    #[derive(Drop, starknet::Event)]
    pub struct DepositAndBorrow {
        #[key]
        pub user: ContractAddress,
        pub wbtc_deposited: u256,
        pub usdc_borrowed: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RepayAndWithdraw {
        #[key]
        pub user: ContractAddress,
        pub usdc_repaid: u256,
        pub wbtc_withdrawn: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OwnershipTransferred {
        pub previous_owner: ContractAddress,
        pub new_owner: ContractAddress,
    }

    // ── Constants ───────────────────────────────────────────────────────

    // Pragma WBTC/USD pair ID: "WBTC/USD" encoded as felt252
    const WBTC_USD_PAIR: felt252 = 0x574254432f555344;

    // ── Constructor ─────────────────────────────────────────────────────

    #[constructor]
    fn constructor(
        ref self: ContractState,
        wbtc: ContractAddress,
        usdc: ContractAddress,
        nostra_collateral_token: ContractAddress,
        nostra_debt_token: ContractAddress,
        pragma_oracle: ContractAddress,
        owner: ContractAddress,
    ) {
        self.wbtc.write(wbtc);
        self.usdc.write(usdc);
        self.nostra_collateral_token.write(nostra_collateral_token);
        self.nostra_debt_token.write(nostra_debt_token);
        self.pragma_oracle.write(pragma_oracle);
        self.owner.write(owner);
        self.total_wbtc_collateral.write(0);
        self.total_usdc_debt.write(0);
        self.user_count.write(0);
        self.is_paused.write(false);

        self.emit(OwnershipTransferred {
            previous_owner: Zero::zero(),
            new_owner: owner,
        });
    }

    // ── Core CDP Functions ──────────────────────────────────────────────

    #[abi(embed_v0)]
    impl CDPImpl of super::ICDP<ContractState> {
        /// Deposit WBTC as collateral and borrow USDC against it.
        /// Caller must have approved this contract to spend `wbtc_amount`.
        fn deposit_and_borrow(
            ref self: ContractState,
            wbtc_amount: u256,
            usdc_borrow_amount: u256,
        ) {
            assert(!self.is_paused.read(), 'CDP: paused');
            assert(wbtc_amount > 0 || usdc_borrow_amount > 0, 'CDP: zero amounts');

            let caller = get_caller_address();
            let this = get_contract_address();
            let wbtc_addr = self.wbtc.read();
            let usdc_addr = self.usdc.read();
            let col_token_addr = self.nostra_collateral_token.read();
            let debt_token_addr = self.nostra_debt_token.read();

            // Step 1: Transfer WBTC from user to this contract and deposit as collateral
            if wbtc_amount > 0 {
                let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };
                wbtc.transfer_from(caller, this, wbtc_amount);
                // Approve Nostra collateral token to pull our WBTC
                wbtc.approve(col_token_addr, wbtc_amount);
                // Deposit WBTC into Nostra — mints iWBTC-c to this contract
                let col_token = INostraCollateralTokenDispatcher { contract_address: col_token_addr };
                col_token.deposit(this, wbtc_amount);
            }

            // Step 2: Borrow USDC from Nostra
            if usdc_borrow_amount > 0 {
                let debt_token = INostraDebtTokenDispatcher { contract_address: debt_token_addr };
                // Borrow mints dUSDC debt and sends underlying USDC to this contract
                debt_token.borrow(this, usdc_borrow_amount);
                // Send borrowed USDC to user
                let usdc = IERC20Dispatcher { contract_address: usdc_addr };
                usdc.transfer(caller, usdc_borrow_amount);
            }

            // Track user position
            if !self.user_exists.read(caller) {
                self.user_exists.write(caller, true);
                self.user_count.write(self.user_count.read() + 1);
            }
            self.user_wbtc_deposited.write(caller, self.user_wbtc_deposited.read(caller) + wbtc_amount);
            self.user_usdc_borrowed.write(caller, self.user_usdc_borrowed.read(caller) + usdc_borrow_amount);
            self.total_wbtc_collateral.write(self.total_wbtc_collateral.read() + wbtc_amount);
            self.total_usdc_debt.write(self.total_usdc_debt.read() + usdc_borrow_amount);

            self.emit(DepositAndBorrow {
                user: caller,
                wbtc_deposited: wbtc_amount,
                usdc_borrowed: usdc_borrow_amount,
            });
        }

        /// Repay USDC debt and withdraw WBTC collateral.
        /// Caller must have approved this contract to spend `usdc_repay_amount`.
        fn repay_and_withdraw(
            ref self: ContractState,
            usdc_repay_amount: u256,
            wbtc_withdraw_amount: u256,
        ) {
            assert(usdc_repay_amount > 0 || wbtc_withdraw_amount > 0, 'CDP: zero amounts');

            let caller = get_caller_address();
            let this = get_contract_address();
            let wbtc_addr = self.wbtc.read();
            let usdc_addr = self.usdc.read();
            let col_token_addr = self.nostra_collateral_token.read();
            let debt_token_addr = self.nostra_debt_token.read();

            // Step 1: Repay USDC debt
            if usdc_repay_amount > 0 {
                let usdc = IERC20Dispatcher { contract_address: usdc_addr };
                usdc.transfer_from(caller, this, usdc_repay_amount);
                // Approve dUSDC to pull USDC for repayment
                usdc.approve(debt_token_addr, usdc_repay_amount);
                // Repay burns dUSDC and pulls USDC
                let debt_token = INostraDebtTokenDispatcher { contract_address: debt_token_addr };
                debt_token.repay(this, usdc_repay_amount);
            }

            // Step 2: Withdraw WBTC collateral
            if wbtc_withdraw_amount > 0 {
                let col_token = INostraCollateralTokenDispatcher { contract_address: col_token_addr };
                // Withdraw burns iWBTC-c and returns WBTC to this contract
                col_token.withdraw(this, this, wbtc_withdraw_amount);
                // Send WBTC back to user
                let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };
                wbtc.transfer(caller, wbtc_withdraw_amount);
            }

            // Update tracking
            let prev_wbtc = self.user_wbtc_deposited.read(caller);
            if wbtc_withdraw_amount <= prev_wbtc {
                self.user_wbtc_deposited.write(caller, prev_wbtc - wbtc_withdraw_amount);
            } else {
                self.user_wbtc_deposited.write(caller, 0);
            }

            let prev_usdc = self.user_usdc_borrowed.read(caller);
            if usdc_repay_amount <= prev_usdc {
                self.user_usdc_borrowed.write(caller, prev_usdc - usdc_repay_amount);
            } else {
                self.user_usdc_borrowed.write(caller, 0);
            }

            let total_wbtc = self.total_wbtc_collateral.read();
            if wbtc_withdraw_amount <= total_wbtc {
                self.total_wbtc_collateral.write(total_wbtc - wbtc_withdraw_amount);
            } else {
                self.total_wbtc_collateral.write(0);
            }

            let total_usdc = self.total_usdc_debt.read();
            if usdc_repay_amount <= total_usdc {
                self.total_usdc_debt.write(total_usdc - usdc_repay_amount);
            } else {
                self.total_usdc_debt.write(0);
            }

            self.emit(RepayAndWithdraw {
                user: caller,
                usdc_repaid: usdc_repay_amount,
                wbtc_withdrawn: wbtc_withdraw_amount,
            });
        }

        /// Close position: repay ALL debt (reads exact dUSDC balance atomically)
        /// and withdraw ALL collateral. Caller must have approved enough USDC.
        fn close_position(ref self: ContractState) {
            let caller = get_caller_address();
            let this = get_contract_address();
            let wbtc_addr = self.wbtc.read();
            let usdc_addr = self.usdc.read();
            let col_token_addr = self.nostra_collateral_token.read();
            let debt_token_addr = self.nostra_debt_token.read();
            let debt_token = INostraDebtTokenDispatcher { contract_address: debt_token_addr };

            // Read the EXACT dUSDC balance at this moment — no race condition
            let exact_debt = debt_token.balance_of(this);

            if exact_debt > 0 {
                let usdc = IERC20Dispatcher { contract_address: usdc_addr };
                // Pull exactly the right amount of USDC from caller
                usdc.transfer_from(caller, this, exact_debt);
                // Approve and repay
                usdc.approve(debt_token_addr, exact_debt);
                debt_token.repay(this, exact_debt);
            }

            // Withdraw ALL collateral
            let col_token = INostraCollateralTokenDispatcher { contract_address: col_token_addr };
            let col_balance = col_token.balance_of(this);
            if col_balance > 0 {
                col_token.withdraw(this, this, col_balance);
                let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };
                let wbtc_balance = wbtc.balance_of(this);
                if wbtc_balance > 0 {
                    wbtc.transfer(caller, wbtc_balance);
                }
            }

            // Clear tracking
            let wbtc_col = self.user_wbtc_deposited.read(caller);
            let usdc_debt = self.user_usdc_borrowed.read(caller);
            self.user_wbtc_deposited.write(caller, 0);
            self.user_usdc_borrowed.write(caller, 0);
            self.total_wbtc_collateral.write(
                if wbtc_col <= self.total_wbtc_collateral.read() {
                    self.total_wbtc_collateral.read() - wbtc_col
                } else { 0 }
            );
            self.total_usdc_debt.write(
                if usdc_debt <= self.total_usdc_debt.read() {
                    self.total_usdc_debt.read() - usdc_debt
                } else { 0 }
            );

            self.emit(RepayAndWithdraw {
                user: caller,
                usdc_repaid: exact_debt,
                wbtc_withdrawn: wbtc_col,
            });
        }

        /// Get user position: (wbtc_collateral, usdc_debt, health_factor_bps)
        /// health_factor_bps: 10000 = 1.0x, 15000 = 1.5x, etc.
        fn get_position(self: @ContractState, user: ContractAddress) -> (u256, u256, u256) {
            let wbtc_col = self.user_wbtc_deposited.read(user);
            let usdc_debt = self.user_usdc_borrowed.read(user);

            if usdc_debt == 0 {
                return (wbtc_col, usdc_debt, 99999);
            }

            let wbtc_price = self._get_wbtc_price();
            if wbtc_price == 0 {
                return (wbtc_col, usdc_debt, 0);
            }

            // wbtc_value_usd = wbtc_col * wbtc_price / 10^8 (WBTC 8 dec, price 8 dec from Pragma)
            // usdc_value_usd = usdc_debt / 10^6 (USDC 6 dec, assume $1)
            // health_bps = (wbtc_value_usd * 10000) / usdc_value_usd
            //            = (wbtc_col * wbtc_price * 10^6 * 10000) / (usdc_debt * 10^8 * 10^8)
            //            = (wbtc_col * wbtc_price * 10000) / (usdc_debt * 10^10)
            let numerator = wbtc_col * wbtc_price.into() * 10000;
            let denominator = usdc_debt * 10000000000; // 10^10
            let health_bps = if denominator > 0 { numerator / denominator } else { 0 };

            (wbtc_col, usdc_debt, health_bps)
        }

        /// Get max additional USDC borrowable at 70% LTV
        fn get_max_borrow(self: @ContractState, user: ContractAddress) -> u256 {
            let wbtc_col = self.user_wbtc_deposited.read(user);
            let usdc_debt = self.user_usdc_borrowed.read(user);

            if wbtc_col == 0 {
                return 0;
            }

            let wbtc_price = self._get_wbtc_price();
            if wbtc_price == 0 {
                return 0;
            }

            // max_borrow_usdc = wbtc_col * wbtc_price * 0.7 * 10^6 / (10^8 * 10^8)
            //                 = wbtc_col * wbtc_price * 7 / 10^11
            let max_total = (wbtc_col * wbtc_price.into() * 7) / 100000000000; // 10^11

            if max_total <= usdc_debt {
                return 0;
            }

            max_total - usdc_debt
        }

        fn total_collateral(self: @ContractState) -> u256 { self.total_wbtc_collateral.read() }
        fn total_debt(self: @ContractState) -> u256 { self.total_usdc_debt.read() }
        fn user_count(self: @ContractState) -> u32 { self.user_count.read() }
    }

    // ── Admin Functions ─────────────────────────────────────────────────

    #[abi(embed_v0)]
    impl AdminImpl of super::ICDPAdmin<ContractState> {
        fn upgrade(ref self: ContractState, new_class_hash: ClassHash) {
            self._assert_owner();
            starknet::syscalls::replace_class_syscall(new_class_hash).unwrap_syscall();
        }

        fn set_nostra_tokens(
            ref self: ContractState,
            collateral_token: ContractAddress,
            debt_token: ContractAddress,
        ) {
            self._assert_owner();
            self.nostra_collateral_token.write(collateral_token);
            self.nostra_debt_token.write(debt_token);
        }

        fn set_pragma_oracle(ref self: ContractState, oracle: ContractAddress) {
            self._assert_owner();
            self.pragma_oracle.write(oracle);
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

        fn get_owner(self: @ContractState) -> ContractAddress { self.owner.read() }
    }

    // ── Internal Helpers ────────────────────────────────────────────────

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _assert_owner(self: @ContractState) {
            assert(get_caller_address() == self.owner.read(), 'Caller is not owner');
        }

        /// Get WBTC price in USD from Pragma oracle (8 decimals)
        fn _get_wbtc_price(self: @ContractState) -> u128 {
            let oracle_addr = self.pragma_oracle.read();
            if oracle_addr.is_zero() {
                return 0;
            }
            let oracle = IPragmaOracleDispatcher { contract_address: oracle_addr };
            let response = oracle.get_data_median(DataType::SpotEntry(WBTC_USD_PAIR));
            response.price
        }
    }
}

// ── External Trait Definitions ──────────────────────────────────────────

#[starknet::interface]
pub trait ICDP<TContractState> {
    fn deposit_and_borrow(ref self: TContractState, wbtc_amount: u256, usdc_borrow_amount: u256);
    fn repay_and_withdraw(ref self: TContractState, usdc_repay_amount: u256, wbtc_withdraw_amount: u256);
    fn close_position(ref self: TContractState);
    fn get_position(self: @TContractState, user: starknet::ContractAddress) -> (u256, u256, u256);
    fn get_max_borrow(self: @TContractState, user: starknet::ContractAddress) -> u256;
    fn total_collateral(self: @TContractState) -> u256;
    fn total_debt(self: @TContractState) -> u256;
    fn user_count(self: @TContractState) -> u32;
}

#[starknet::interface]
pub trait ICDPAdmin<TContractState> {
    fn upgrade(ref self: TContractState, new_class_hash: starknet::ClassHash);
    fn set_nostra_tokens(ref self: TContractState, collateral_token: starknet::ContractAddress, debt_token: starknet::ContractAddress);
    fn set_pragma_oracle(ref self: TContractState, oracle: starknet::ContractAddress);
    fn pause(ref self: TContractState);
    fn unpause(ref self: TContractState);
    fn transfer_ownership(ref self: TContractState, new_owner: starknet::ContractAddress);
    fn accept_ownership(ref self: TContractState);
    fn get_owner(self: @TContractState) -> starknet::ContractAddress;
}
