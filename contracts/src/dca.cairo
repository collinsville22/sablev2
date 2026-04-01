/// BTCVault Smart DCA — On-Chain Dollar-Cost Averaging with Mayer Multiple
///
/// Users deposit sell tokens (ETH, USDC, STRK, USDT) and configure recurring
/// BTC purchases. A permissionless keeper triggers executions when orders are due.
///
/// Smart DCA mode uses Pragma Oracle's spot price and 200-day TWAP to compute
/// the Mayer Multiple (price / 200d MA), dynamically adjusting buy amounts:
///   MM < 0.8  → 1.5x (very cheap)
///   0.8-1.0   → 1.25x (below average)
///   1.0-1.5   → 1.0x (normal)
///   1.5-2.0   → 0.75x (expensive)
///   > 2.0     → 0.5x (overheated)
///
/// Keeper earns a configurable fee (default 0.1%) per execution.
/// AVNU routes must be provided by the keeper (computed off-chain via AVNU API).

#[starknet::contract]
pub mod SmartDca {
    use starknet::{ContractAddress, ClassHash, get_caller_address, get_contract_address, get_block_timestamp};
    use starknet::SyscallResultTrait;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess, StorageMapReadAccess, StorageMapWriteAccess};
    use core::num::traits::Zero;

    use btcvault::interfaces::{
        IERC20Dispatcher, IERC20DispatcherTrait,
        IAvnuExchangeDispatcher, IAvnuExchangeDispatcherTrait,
        IPragmaOracleDispatcher, IPragmaOracleDispatcherTrait,
        ISummaryStatsDispatcher, ISummaryStatsDispatcherTrait,
        Route, DataType, AggregationMode,
    };

    use btcvault::strategy::addresses;

    // ── Constants ────────────────────────────────────────────────────────

    // Mayer Multiple is scaled to 1e8 for integer math
    const SCALE: u128 = 100_000_000; // 1e8

    // Mayer Multiple band thresholds (scaled by 1e8)
    const MM_BAND_1: u128 = 80_000_000;  // 0.8
    const MM_BAND_2: u128 = 100_000_000; // 1.0
    const MM_BAND_3: u128 = 150_000_000; // 1.5
    const MM_BAND_4: u128 = 200_000_000; // 2.0

    // Multipliers (scaled by 100 for integer %)
    const MULT_VERY_CHEAP: u256 = 150;  // 1.5x
    const MULT_CHEAP: u256 = 125;       // 1.25x
    const MULT_NORMAL: u256 = 100;      // 1.0x
    const MULT_EXPENSIVE: u256 = 75;    // 0.75x
    const MULT_OVERHEATED: u256 = 50;   // 0.5x

    // 200 days in seconds for TWAP window
    const TWAP_WINDOW: u64 = 200 * 24 * 60 * 60; // 17,280,000 seconds

    // ── Storage ──────────────────────────────────────────────────────────

    #[storage]
    struct Storage {
        owner: ContractAddress,
        keeper_fee_bps: u16,          // basis points (10 = 0.1%)
        next_order_id: u64,

        // Order fields (flat maps — Starknet storage can't store structs in Maps)
        order_owner: starknet::storage::Map<u64, ContractAddress>,
        order_sell_token: starknet::storage::Map<u64, ContractAddress>,
        order_sell_amount: starknet::storage::Map<u64, u256>,   // base per-execution amount (raw)
        order_frequency: starknet::storage::Map<u64, u64>,      // seconds between executions
        order_total: starknet::storage::Map<u64, u32>,          // total planned executions
        order_executed: starknet::storage::Map<u64, u32>,       // completed count
        order_next_exec: starknet::storage::Map<u64, u64>,      // next execution timestamp
        order_active: starknet::storage::Map<u64, bool>,
        order_smart: starknet::storage::Map<u64, bool>,         // use Mayer Multiple
        order_deposited: starknet::storage::Map<u64, u256>,     // total sell tokens deposited
        order_spent: starknet::storage::Map<u64, u256>,         // total sell tokens used
        order_btc_received: starknet::storage::Map<u64, u256>,  // total WBTC received
    }

    // ── Events ───────────────────────────────────────────────────────────

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        OrderCreated: OrderCreated,
        OrderCancelled: OrderCancelled,
        OrderExecuted: OrderExecuted,
        OrderCompleted: OrderCompleted,
        KeeperFeeUpdated: KeeperFeeUpdated,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OrderCreated {
        #[key]
        pub order_id: u64,
        #[key]
        pub owner: ContractAddress,
        pub sell_token: ContractAddress,
        pub sell_amount_per: u256,
        pub frequency: u64,
        pub total_orders: u32,
        pub smart: bool,
        pub total_deposited: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OrderCancelled {
        #[key]
        pub order_id: u64,
        pub refunded: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OrderExecuted {
        #[key]
        pub order_id: u64,
        #[key]
        pub keeper: ContractAddress,
        pub sell_amount: u256,
        pub btc_received: u256,
        pub keeper_fee: u256,
        pub mayer_multiple: u128,
        pub execution_number: u32,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OrderCompleted {
        #[key]
        pub order_id: u64,
        pub total_spent: u256,
        pub total_btc: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct KeeperFeeUpdated {
        pub old_fee: u16,
        pub new_fee: u16,
    }

    // ── Constructor ──────────────────────────────────────────────────────

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress, keeper_fee_bps: u16) {
        assert(!owner.is_zero(), 'Owner cannot be zero');
        assert(keeper_fee_bps <= 100, 'Fee too high'); // max 1%
        self.owner.write(owner);
        self.keeper_fee_bps.write(keeper_fee_bps);
        self.next_order_id.write(1);
    }

    // ── External ─────────────────────────────────────────────────────────

    #[abi(embed_v0)]
    impl SmartDcaImpl of super::ISmartDca<ContractState> {
        /// Create a new DCA order. Caller deposits sell_amount_per * total_orders of sell_token.
        /// First execution is due immediately (next_exec = now).
        fn create_order(
            ref self: ContractState,
            sell_token: ContractAddress,
            sell_amount_per: u256,
            frequency: u64,
            total_orders: u32,
            smart: bool,
        ) -> u64 {
            let caller = get_caller_address();
            assert(!sell_token.is_zero(), 'Invalid sell token');
            assert(sell_amount_per > 0, 'Amount must be > 0');
            assert(frequency >= 3600, 'Min frequency 1 hour');
            assert(total_orders >= 1 && total_orders <= 365, 'Orders: 1-365');

            // For smart DCA, user deposits 1.5x * total to cover max multiplier
            let deposit_multiplier: u256 = if smart { 150 } else { 100 };
            let total_deposit = (sell_amount_per * total_orders.into() * deposit_multiplier) / 100;

            // Transfer sell tokens from caller to this contract
            let token = IERC20Dispatcher { contract_address: sell_token };
            token.transfer_from(caller, get_contract_address(), total_deposit);

            let order_id = self.next_order_id.read();
            self.next_order_id.write(order_id + 1);

            self.order_owner.write(order_id, caller);
            self.order_sell_token.write(order_id, sell_token);
            self.order_sell_amount.write(order_id, sell_amount_per);
            self.order_frequency.write(order_id, frequency);
            self.order_total.write(order_id, total_orders);
            self.order_executed.write(order_id, 0);
            self.order_next_exec.write(order_id, get_block_timestamp());
            self.order_active.write(order_id, true);
            self.order_smart.write(order_id, smart);
            self.order_deposited.write(order_id, total_deposit);
            self.order_spent.write(order_id, 0);
            self.order_btc_received.write(order_id, 0);

            self.emit(OrderCreated {
                order_id,
                owner: caller,
                sell_token,
                sell_amount_per,
                frequency,
                total_orders,
                smart,
                total_deposited: total_deposit,
            });

            order_id
        }

        /// Cancel an active order. Refunds remaining deposited - spent tokens to owner.
        fn cancel_order(ref self: ContractState, order_id: u64) {
            let caller = get_caller_address();
            let owner = self.order_owner.read(order_id);
            assert(caller == owner, 'Not order owner');
            assert(self.order_active.read(order_id), 'Order not active');

            self.order_active.write(order_id, false);

            let deposited = self.order_deposited.read(order_id);
            let spent = self.order_spent.read(order_id);
            let refund = deposited - spent;

            if refund > 0 {
                let token = IERC20Dispatcher { contract_address: self.order_sell_token.read(order_id) };
                token.transfer(owner, refund);
            }

            self.emit(OrderCancelled { order_id, refunded: refund });
        }

        /// Execute a due DCA order. Callable by anyone (keeper).
        /// Keeper provides AVNU routes (computed off-chain) and receives a fee.
        fn execute_order(
            ref self: ContractState,
            order_id: u64,
            min_btc_out: u256,
            routes: Array<Route>,
        ) {
            let keeper = get_caller_address();
            let this = get_contract_address();
            let now = get_block_timestamp();

            // Validate order is due
            assert(self.order_active.read(order_id), 'Order not active');
            let next_exec = self.order_next_exec.read(order_id);
            assert(now >= next_exec, 'Not yet due');
            let executed = self.order_executed.read(order_id);
            let total = self.order_total.read(order_id);
            assert(executed < total, 'Order complete');

            let base_amount = self.order_sell_amount.read(order_id);
            let sell_token = self.order_sell_token.read(order_id);
            let order_owner = self.order_owner.read(order_id);
            let is_smart = self.order_smart.read(order_id);

            // Compute adjusted sell amount
            let mut mayer_multiple: u128 = SCALE; // default 1.0 (non-smart)
            let adjusted_amount = if is_smart {
                let (spot, twap, mm) = self._get_mayer_multiple();
                mayer_multiple = mm;
                let _ = spot; // suppress unused warning
                let _ = twap;
                let multiplier = self._get_multiplier(mm);
                (base_amount * multiplier) / 100
            } else {
                base_amount
            };

            // Ensure we have enough deposited funds
            let deposited = self.order_deposited.read(order_id);
            let spent = self.order_spent.read(order_id);
            let remaining = deposited - spent;
            assert(remaining >= adjusted_amount, 'Insufficient deposit');

            // Deduct keeper fee
            let fee_bps: u256 = self.keeper_fee_bps.read().into();
            let keeper_fee = (adjusted_amount * fee_bps) / 10000;
            let swap_amount = adjusted_amount - keeper_fee;

            // Approve AVNU and execute swap
            let wbtc_addr: ContractAddress = addresses::WBTC.try_into().unwrap();
            let avnu_addr: ContractAddress = addresses::AVNU_EXCHANGE.try_into().unwrap();
            let sell_erc20 = IERC20Dispatcher { contract_address: sell_token };
            sell_erc20.approve(avnu_addr, swap_amount);

            let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };
            let btc_before = wbtc.balance_of(this);

            let avnu = IAvnuExchangeDispatcher { contract_address: avnu_addr };
            avnu.multi_route_swap(
                sell_token, swap_amount, wbtc_addr,
                0, min_btc_out,
                this, // beneficiary = this contract (we distribute after)
                0, Zero::zero(), // no integrator fee
                routes,
            );

            let btc_after = wbtc.balance_of(this);
            let btc_received = btc_after - btc_before;
            assert(btc_received > 0, 'Swap returned 0');

            // Transfer WBTC to order owner
            wbtc.transfer(order_owner, btc_received);

            // Pay keeper fee in sell token
            if keeper_fee > 0 {
                sell_erc20.transfer(keeper, keeper_fee);
            }

            // Update order state
            let new_executed = executed + 1;
            let new_spent = spent + adjusted_amount;
            let new_btc = self.order_btc_received.read(order_id) + btc_received;

            self.order_executed.write(order_id, new_executed);
            self.order_spent.write(order_id, new_spent);
            self.order_btc_received.write(order_id, new_btc);

            self.emit(OrderExecuted {
                order_id,
                keeper,
                sell_amount: adjusted_amount,
                btc_received,
                keeper_fee,
                mayer_multiple,
                execution_number: new_executed,
            });

            if new_executed >= total {
                // Order complete — refund any remaining deposit
                self.order_active.write(order_id, false);
                let final_remaining = deposited - new_spent;
                if final_remaining > 0 {
                    sell_erc20.transfer(order_owner, final_remaining);
                }
                self.emit(OrderCompleted {
                    order_id,
                    total_spent: new_spent,
                    total_btc: new_btc,
                });
            } else {
                // Schedule next execution
                let frequency = self.order_frequency.read(order_id);
                self.order_next_exec.write(order_id, now + frequency);
            }
        }

        /// Add more sell tokens to an existing active order.
        fn top_up_order(ref self: ContractState, order_id: u64, amount: u256) {
            let caller = get_caller_address();
            assert(caller == self.order_owner.read(order_id), 'Not order owner');
            assert(self.order_active.read(order_id), 'Order not active');
            assert(amount > 0, 'Amount must be > 0');

            let token = IERC20Dispatcher { contract_address: self.order_sell_token.read(order_id) };
            token.transfer_from(caller, get_contract_address(), amount);

            let deposited = self.order_deposited.read(order_id);
            self.order_deposited.write(order_id, deposited + amount);
        }

        // ── View Functions ───────────────────────────────────────────────

        /// Get current Mayer Multiple: (spot_price, twap_200d, mayer_multiple)
        /// All values scaled to 1e8.
        fn get_mayer_multiple(self: @ContractState) -> (u128, u128, u128) {
            self._get_mayer_multiple()
        }

        /// Get order details.
        fn get_order(self: @ContractState, order_id: u64) -> (
            ContractAddress, // owner
            ContractAddress, // sell_token
            u256,            // sell_amount_per
            u64,             // frequency
            u32,             // total
            u32,             // executed
            u64,             // next_exec
            bool,            // active
            bool,            // smart
            u256,            // deposited
            u256,            // spent
            u256,            // btc_received
        ) {
            (
                self.order_owner.read(order_id),
                self.order_sell_token.read(order_id),
                self.order_sell_amount.read(order_id),
                self.order_frequency.read(order_id),
                self.order_total.read(order_id),
                self.order_executed.read(order_id),
                self.order_next_exec.read(order_id),
                self.order_active.read(order_id),
                self.order_smart.read(order_id),
                self.order_deposited.read(order_id),
                self.order_spent.read(order_id),
                self.order_btc_received.read(order_id),
            )
        }

        fn get_next_order_id(self: @ContractState) -> u64 {
            self.next_order_id.read()
        }

        fn get_keeper_fee_bps(self: @ContractState) -> u16 {
            self.keeper_fee_bps.read()
        }

        fn get_owner(self: @ContractState) -> ContractAddress {
            self.owner.read()
        }

        // ── Admin ────────────────────────────────────────────────────────

        fn set_keeper_fee(ref self: ContractState, new_fee_bps: u16) {
            assert(get_caller_address() == self.owner.read(), 'Not owner');
            assert(new_fee_bps <= 100, 'Fee too high'); // max 1%
            let old = self.keeper_fee_bps.read();
            self.keeper_fee_bps.write(new_fee_bps);
            self.emit(KeeperFeeUpdated { old_fee: old, new_fee: new_fee_bps });
        }

        fn transfer_ownership(ref self: ContractState, new_owner: ContractAddress) {
            assert(get_caller_address() == self.owner.read(), 'Not owner');
            assert(!new_owner.is_zero(), 'New owner cannot be zero');
            self.owner.write(new_owner);
        }

        fn upgrade(ref self: ContractState, new_class_hash: ClassHash) {
            assert(get_caller_address() == self.owner.read(), 'Not owner');
            starknet::syscalls::replace_class_syscall(new_class_hash).unwrap_syscall();
        }
    }

    // ── Internal Helpers ─────────────────────────────────────────────────

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        /// Query Pragma Oracle for BTC spot price and 200-day TWAP,
        /// then compute Mayer Multiple = spot / twap.
        /// Returns (spot, twap, mayer_multiple) all scaled to 1e8.
        fn _get_mayer_multiple(self: @ContractState) -> (u128, u128, u128) {
            let oracle_addr: ContractAddress = addresses::PRAGMA_ORACLE.try_into().unwrap();
            let oracle = IPragmaOracleDispatcher { contract_address: oracle_addr };

            // Get spot price
            let pair_id = addresses::PRAGMA_BTC_USD_PAIR;
            let spot_response = oracle.get_data_median(DataType::SpotEntry(pair_id));
            let spot_price = spot_response.price;
            let spot_decimals = spot_response.decimals;

            // Get 200-day TWAP from Summary Stats
            let stats_addr: ContractAddress = addresses::PRAGMA_SUMMARY_STATS.try_into().unwrap();
            let stats = ISummaryStatsDispatcher { contract_address: stats_addr };

            let now = get_block_timestamp();
            let start_time = if now > TWAP_WINDOW { now - TWAP_WINDOW } else { 0 };

            let (twap_price, twap_decimals) = stats.calculate_twap(
                DataType::SpotEntry(pair_id),
                AggregationMode::Median,
                now,
                start_time,
            );

            // Normalize both to 1e8 scale
            let spot_normalized = if spot_decimals >= 8 {
                spot_price / Self::_pow10(spot_decimals - 8)
            } else {
                spot_price * Self::_pow10(8 - spot_decimals)
            };

            let twap_normalized = if twap_decimals >= 8 {
                twap_price / Self::_pow10(twap_decimals - 8)
            } else {
                twap_price * Self::_pow10(8 - twap_decimals)
            };

            // Mayer Multiple = (spot / twap) * 1e8
            let mayer_multiple = if twap_normalized > 0 {
                (spot_normalized * SCALE) / twap_normalized
            } else {
                SCALE // default to 1.0 if TWAP unavailable
            };

            (spot_normalized, twap_normalized, mayer_multiple)
        }

        /// Get the buy multiplier for a given Mayer Multiple value (scaled 1e8).
        /// Returns multiplier as percentage (150 = 1.5x, 100 = 1.0x, etc.)
        fn _get_multiplier(self: @ContractState, mm: u128) -> u256 {
            if mm < MM_BAND_1 {
                MULT_VERY_CHEAP  // < 0.8 → 1.5x
            } else if mm < MM_BAND_2 {
                MULT_CHEAP       // 0.8-1.0 → 1.25x
            } else if mm < MM_BAND_3 {
                MULT_NORMAL      // 1.0-1.5 → 1.0x
            } else if mm < MM_BAND_4 {
                MULT_EXPENSIVE   // 1.5-2.0 → 0.75x
            } else {
                MULT_OVERHEATED  // > 2.0 → 0.5x
            }
        }

        /// 10^n for u128
        fn _pow10(n: u32) -> u128 {
            let mut result: u128 = 1;
            let mut i: u32 = 0;
            while i < n {
                result *= 10;
                i += 1;
            };
            result
        }
    }
}

// ── Interface ────────────────────────────────────────────────────────────

use btcvault::interfaces::Route;

#[starknet::interface]
pub trait ISmartDca<TContractState> {
    fn create_order(
        ref self: TContractState,
        sell_token: starknet::ContractAddress,
        sell_amount_per: u256,
        frequency: u64,
        total_orders: u32,
        smart: bool,
    ) -> u64;
    fn cancel_order(ref self: TContractState, order_id: u64);
    fn execute_order(
        ref self: TContractState,
        order_id: u64,
        min_btc_out: u256,
        routes: Array<Route>,
    );
    fn top_up_order(ref self: TContractState, order_id: u64, amount: u256);
    fn get_mayer_multiple(self: @TContractState) -> (u128, u128, u128);
    fn get_order(self: @TContractState, order_id: u64) -> (
        starknet::ContractAddress,
        starknet::ContractAddress,
        u256, u64, u32, u32, u64, bool, bool, u256, u256, u256,
    );
    fn get_next_order_id(self: @TContractState) -> u64;
    fn get_keeper_fee_bps(self: @TContractState) -> u16;
    fn get_owner(self: @TContractState) -> starknet::ContractAddress;
    fn set_keeper_fee(ref self: TContractState, new_fee_bps: u16);
    fn transfer_ownership(ref self: TContractState, new_owner: starknet::ContractAddress);
    fn upgrade(ref self: TContractState, new_class_hash: starknet::ClassHash);
}
