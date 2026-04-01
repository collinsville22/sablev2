export const CDP_ABI = [
  {
    type: "function",
    name: "deposit_and_borrow",
    inputs: [
      { name: "wbtc_amount", type: "core::integer::u256" },
      { name: "usdc_borrow_amount", type: "core::integer::u256" },
    ],
    outputs: [],
    state_mutability: "external",
  },
  {
    type: "function",
    name: "repay_and_withdraw",
    inputs: [
      { name: "usdc_repay_amount", type: "core::integer::u256" },
      { name: "wbtc_withdraw_amount", type: "core::integer::u256" },
    ],
    outputs: [],
    state_mutability: "external",
  },
  {
    type: "function",
    name: "close_position",
    inputs: [],
    outputs: [],
    state_mutability: "external",
  },
  {
    type: "function",
    name: "get_position",
    inputs: [{ name: "user", type: "core::starknet::contract_address::ContractAddress" }],
    outputs: [
      { type: "core::integer::u256" },
      { type: "core::integer::u256" },
      { type: "core::integer::u256" },
    ],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "get_max_borrow",
    inputs: [{ name: "user", type: "core::starknet::contract_address::ContractAddress" }],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "total_collateral",
    inputs: [],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "total_debt",
    inputs: [],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "user_count",
    inputs: [],
    outputs: [{ type: "core::integer::u32" }],
    state_mutability: "view",
  },
] as const;
