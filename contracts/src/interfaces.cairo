use starknet::ContractAddress;

// ── Vesu V2 Pool Interface ──────────────────────────────────────────────

// Vesu V2 Amount: denomination + signed value (no AmountType in V2)
#[derive(Copy, Drop, Serde)]
pub struct Amount {
    pub denomination: AmountDenomination,
    pub value: i257,
}

#[derive(Copy, Drop, Serde)]
pub enum AmountDenomination {
    Native,
    Assets,
}

// i257: signed 257-bit integer used by Vesu for positions
#[derive(Copy, Drop, Serde)]
pub struct i257 {
    pub abs: u256,
    pub is_negative: bool,
}

// Vesu V2: no pool_id (call pool contract directly), no data field
#[derive(Copy, Drop, Serde)]
pub struct ModifyPositionParams {
    pub collateral_asset: ContractAddress,
    pub debt_asset: ContractAddress,
    pub user: ContractAddress,
    pub collateral: Amount,
    pub debt: Amount,
}

#[derive(Copy, Drop, Serde)]
pub struct UpdatePositionResponse {
    pub collateral_delta: i257,
    pub collateral_shares_delta: i257,
    pub debt_delta: i257,
    pub nominal_debt_delta: i257,
    pub bad_debt: u256,
}

// Position data returned by Vesu
#[derive(Copy, Drop, Serde)]
pub struct Position {
    pub collateral_shares: u256,
    pub nominal_debt: u256,
}

// Vesu asset configuration (returned by pool extension's asset_config)
#[derive(Copy, Drop, Serde)]
pub struct VesuAssetConfig {
    pub total_collateral_shares: u256,
    pub total_nominal_debt: u256,
    pub reserve: u256,
    pub max_utilization: u256,
    pub floor: u256,       // Minimum position value in WAD ($10 = 10 * 10^18)
    pub scale: u256,       // Asset native decimal scale (10^8 for WBTC)
    pub is_legacy: bool,
    pub last_updated: u64,
    pub last_rate_accumulator: u256,
    pub last_full_utilization_rate: u256,
    pub fee_rate: u256,
    pub last_interest_rate: u256,
}

// Vesu asset price (returned by pool extension's price)
#[derive(Copy, Drop, Serde)]
pub struct VesuAssetPrice {
    pub value: u256,       // USD price in WAD (18 decimals)
    pub is_valid: bool,
}

#[starknet::interface]
pub trait IVesuPool<TContractState> {
    fn modify_position(ref self: TContractState, params: ModifyPositionParams) -> UpdatePositionResponse;
    fn donate_to_reserve(ref self: TContractState, asset: ContractAddress, amount: u256);
    // Read position: returns (Position, collateral_amount_u256, debt_amount_u256)
    fn position(
        self: @TContractState,
        collateral_asset: ContractAddress,
        debt_asset: ContractAddress,
        user: ContractAddress,
    ) -> (Position, u256, u256);
    // Query asset configuration (includes floor/dust threshold and scale)
    fn asset_config(self: @TContractState, asset: ContractAddress) -> VesuAssetConfig;
    // Query asset oracle price in WAD
    fn price(self: @TContractState, asset: ContractAddress) -> VesuAssetPrice;
    // Flash loan: borrow tokens, call on_flash_loan callback, pull tokens back. Zero fee.
    fn flash_loan(
        ref self: TContractState,
        receiver: ContractAddress,
        asset: ContractAddress,
        amount: u256,
        is_legacy: bool,
        data: Span<felt252>,
    );
}

// ── Vesu Singleton (same interface, different deployment) ───────────────

pub const VESU_SINGLETON: felt252 = 0x000d8d6dfec4d33bfb6895de9f3852143a17c6f92fd2a21da3d6924d34870160;

// ── Nostra Interest-Bearing Collateral Token (iWBTC-c) ─────────────────

#[starknet::interface]
pub trait INostraCollateralToken<TContractState> {
    fn deposit(ref self: TContractState, to: ContractAddress, amount: u256);
    fn withdraw(ref self: TContractState, from: ContractAddress, to: ContractAddress, amount: u256) -> u256;
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    fn underlying_asset(self: @TContractState) -> ContractAddress;
}

// ── Nostra Debt Token (dUSDC) ──────────────────────────────────────────

#[starknet::interface]
pub trait INostraDebtToken<TContractState> {
    fn borrow(ref self: TContractState, to: ContractAddress, amount: u256);
    fn repay(ref self: TContractState, from: ContractAddress, amount: u256) -> u256;
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    fn min_debt(self: @TContractState) -> u256;
    fn underlying_asset(self: @TContractState) -> ContractAddress;
}

// ── Vesu Flash Loan Receiver Interface ───────────────────────────────────

#[starknet::interface]
pub trait IFlashloanReceiver<TContractState> {
    fn on_flash_loan(
        ref self: TContractState,
        sender: ContractAddress,
        asset: ContractAddress,
        amount: u256,
        data: Span<felt252>,
    );
}

// ── AVNU Exchange Interface ─────────────────────────────────────────────

#[derive(Copy, Drop, Serde)]
pub struct Route {
    pub token_from: ContractAddress,
    pub token_to: ContractAddress,
    pub exchange_address: ContractAddress,
    pub percent: u128,
    pub additional_swap_params: Span<felt252>,
}

#[starknet::interface]
pub trait IAvnuExchange<TContractState> {
    fn multi_route_swap(
        ref self: TContractState,
        token_from_address: ContractAddress,
        token_from_amount: u256,
        token_to_address: ContractAddress,
        token_to_amount: u256,
        token_to_min_amount: u256,
        beneficiary: ContractAddress,
        integrator_fee_amount_bps: u128,
        integrator_fee_recipient: ContractAddress,
        routes: Array<Route>,
    ) -> bool;
}

// ── ERC20 Interface ─────────────────────────────────────────────────────

#[starknet::interface]
pub trait IERC20<TContractState> {
    fn name(self: @TContractState) -> ByteArray;
    fn symbol(self: @TContractState) -> ByteArray;
    fn decimals(self: @TContractState) -> u8;
    fn total_supply(self: @TContractState) -> u256;
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    fn allowance(self: @TContractState, owner: ContractAddress, spender: ContractAddress) -> u256;
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256) -> bool;
    fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;
}

// ── ERC4626 Interface (Vesu vToken) ─────────────────────────────────────

#[starknet::interface]
pub trait IERC4626<TContractState> {
    fn asset(self: @TContractState) -> ContractAddress;
    fn total_assets(self: @TContractState) -> u256;
    fn convert_to_shares(self: @TContractState, assets: u256) -> u256;
    fn convert_to_assets(self: @TContractState, shares: u256) -> u256;
    fn max_deposit(self: @TContractState, receiver: ContractAddress) -> u256;
    fn preview_deposit(self: @TContractState, assets: u256) -> u256;
    fn deposit(ref self: TContractState, assets: u256, receiver: ContractAddress) -> u256;
    fn max_mint(self: @TContractState, receiver: ContractAddress) -> u256;
    fn preview_mint(self: @TContractState, shares: u256) -> u256;
    fn mint(ref self: TContractState, shares: u256, receiver: ContractAddress) -> u256;
    fn max_withdraw(self: @TContractState, owner: ContractAddress) -> u256;
    fn preview_withdraw(self: @TContractState, assets: u256) -> u256;
    fn withdraw(ref self: TContractState, assets: u256, receiver: ContractAddress, owner: ContractAddress) -> u256;
    fn max_redeem(self: @TContractState, owner: ContractAddress) -> u256;
    fn preview_redeem(self: @TContractState, shares: u256) -> u256;
    fn redeem(ref self: TContractState, shares: u256, receiver: ContractAddress, owner: ContractAddress) -> u256;
}

// ── Ekubo Types ──────────────────────────────────────────────────────

#[derive(Copy, Drop, Serde)]
pub struct i129 {
    pub mag: u128,
    pub sign: bool,
}

#[derive(Copy, Drop, Serde)]
pub struct PoolKey {
    pub token0: ContractAddress,
    pub token1: ContractAddress,
    pub fee: u128,
    pub tick_spacing: u128,
    pub extension: ContractAddress,
}

#[derive(Copy, Drop, Serde)]
pub struct Bounds {
    pub lower: i129,
    pub upper: i129,
}

// ── Ekubo Pool Price (returned by Core/Positions) ───────────────────

#[derive(Copy, Drop, Serde)]
pub struct PoolPrice {
    pub sqrt_ratio: u256,
    pub tick: i129,
}

#[derive(Copy, Drop, Serde)]
pub struct GetTokenInfoResult {
    pub pool_price: PoolPrice,
    pub liquidity: u128,
    pub amount0: u128,
    pub amount1: u128,
    pub fees0: u128,
    pub fees1: u128,
}

// ── Ekubo Core Interface ─────────────────────────────────────────────

#[starknet::interface]
pub trait IEkuboCore<TContractState> {
    fn lock(ref self: TContractState, data: Array<felt252>) -> Array<felt252>;
    fn pay(ref self: TContractState, token_address: ContractAddress);
    fn withdraw(
        ref self: TContractState,
        token_address: ContractAddress,
        recipient: ContractAddress,
        amount: u128,
    );
    fn get_pool_price(self: @TContractState, pool_key: PoolKey) -> PoolPrice;
}

// ── Ekubo Positions Interface ────────────────────────────────────────

#[starknet::interface]
pub trait IEkuboPositions<TContractState> {
    fn mint_and_deposit(
        ref self: TContractState,
        pool_key: PoolKey,
        bounds: Bounds,
        min_liquidity: u128,
    ) -> (u64, u128);
    fn deposit(
        ref self: TContractState,
        id: u64,
        pool_key: PoolKey,
        bounds: Bounds,
        min_liquidity: u128,
    ) -> u128;
    fn withdraw(
        ref self: TContractState,
        id: u64,
        pool_key: PoolKey,
        bounds: Bounds,
        liquidity: u128,
        min_token0: u128,
        min_token1: u128,
        collect_fees: bool,
    ) -> (u128, u128);
    fn get_token_info(
        self: @TContractState,
        id: u64,
        pool_key: PoolKey,
        bounds: Bounds,
    ) -> GetTokenInfoResult;
}

// ── ILocker — contract must implement this for Ekubo callbacks ───────

#[starknet::interface]
pub trait ILocker<TContractState> {
    fn locked(ref self: TContractState, id: u32, data: Span<felt252>) -> Span<felt252>;
}

// ── Garaga ZK Verifier Interfaces (auto-generated by garaga gen) ─────

// UltraHonk verifier (Noir circuits, V1)
#[starknet::interface]
pub trait IGaragaVerifier<TContractState> {
    fn verify_ultra_keccak_zk_honk_proof(
        self: @TContractState,
        full_proof_with_hints: Span<felt252>,
    ) -> Result<Span<u256>, felt252>;
}

// Groth16 BN254 verifier (Circom circuits, V2)
#[starknet::interface]
pub trait IGroth16Verifier<TContractState> {
    fn verify_groth16_proof_bn254(
        self: @TContractState,
        full_proof_with_hints: Span<felt252>,
    ) -> Result<Span<u256>, felt252>;
}

// ── Pragma Oracle Interface ─────────────────────────────────────────

#[derive(Copy, Drop, Serde)]
pub enum DataType {
    SpotEntry: felt252,
    FutureEntry: (felt252, u64),
    GenericEntry: felt252,
}

#[derive(Copy, Drop, Serde)]
pub struct PragmaPricesResponse {
    pub price: u128,
    pub decimals: u32,
    pub last_updated_timestamp: u64,
    pub num_sources_aggregated: u32,
    pub expiration_timestamp: Option<u64>,
}

#[starknet::interface]
pub trait IPragmaOracle<TContractState> {
    fn get_data_median(self: @TContractState, data_type: DataType) -> PragmaPricesResponse;
}

// ── Pragma Summary Stats (TWAP) ──────────────────────────────────────

#[derive(Copy, Drop, Serde)]
pub enum AggregationMode {
    Median,
    Mean,
    Error,
}

#[starknet::interface]
pub trait ISummaryStats<TContractState> {
    fn calculate_twap(
        self: @TContractState,
        data_type: DataType,
        aggregation_mode: AggregationMode,
        time: u64,
        start_time: u64,
    ) -> (u128, u32);
}
