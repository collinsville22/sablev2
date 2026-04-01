/// Strategy utilities for BTCVault
/// Contains helper functions and constants for yield strategies

/// Known addresses on StarkNet mainnet
pub mod addresses {
    pub const WBTC: felt252 = 0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac;
    pub const USDC: felt252 = 0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8;
    pub const USDT: felt252 = 0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8;
    pub const ETH: felt252 = 0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7;
    pub const STRK: felt252 = 0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d;

    // Vesu V2
    pub const VESU_SINGLETON: felt252 = 0x000d8d6dfec4d33bfb6895de9f3852143a17c6f92fd2a21da3d6924d34870160;
    pub const VESU_RE7_XBTC_POOL: felt252 = 0x03a8416bf20d036df5b1cf3447630a2e1cb04685f6b0c3a70ed7fb1473548ecf;
    pub const VESU_PRIME_POOL: felt252 = 0x0451fe483d5921a2919ddd81d0de6696669bccdacd859f72a4fba7656b97c3b5;

    // AVNU DEX aggregator
    pub const AVNU_EXCHANGE: felt252 = 0x04270219d365d6b017231b52e92b3fb5d7c8378b05e9abc97724537a80e93b0f;

    // Endur liquid staking (ERC-4626 vault: WBTC → xWBTC)
    pub const ENDUR_XWBTC_VAULT: felt252 = 0x06a567e68c805323525fe1649adb80b03cddf92c23d2629a6779f54192dffc13;

    // Vesu Re7 USDC Core pool (for delta-neutral USDC yield)
    pub const VESU_RE7_USDC_CORE: felt252 = 0x03976cac265a12609934089004df458ea29c776d77da423c96dc761d09d24124;

    // Ekubo DEX — concentrated liquidity
    pub const EKUBO_CORE: felt252 = 0x00000005dd3d2f4429af886cd1a3b08289dbcea99a294197e9eb43b0e0325b4b;
    pub const EKUBO_POSITIONS: felt252 = 0x02e0af29598b407c8716b17f6d2795eca1b471413fa03fb145a5e33722184067;

    // Pragma Oracle — on-chain price feeds
    pub const PRAGMA_ORACLE: felt252 = 0x2a85bd616f912537c50a49a4076db02c00b29b2cdc8a197ce92ed1837fa875b;

    // Pragma Summary Stats — TWAP calculations
    pub const PRAGMA_SUMMARY_STATS: felt252 = 0x49eefafae944d07744d07cc72a5bf14728a6fb463c3eae5bca13552f5d455fd;

    // BTC/USD pair ID for Pragma Oracle
    pub const PRAGMA_BTC_USD_PAIR: felt252 = 0x4254432f555344; // "BTC/USD"
}

/// Maximum leverage ratio (3x = deposit $100 WBTC, borrow $200 USDC equivalent)
pub const MAX_LEVERAGE_RATIO: u8 = 3;

/// Minimum health factor (1.5x = 150%) to prevent liquidation
pub const MIN_HEALTH_FACTOR_BPS: u256 = 15000; // 150.00%

/// Maximum single loop borrow as % of collateral value (in BPS)
pub const MAX_LTV_BPS: u256 = 7000; // 70% LTV per loop
