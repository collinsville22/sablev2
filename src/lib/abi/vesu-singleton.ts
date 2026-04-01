/**
 * Minimal ABI for Vesu vToken contracts (ERC-4626 vault interface).
 * Used for direct WBTC supply (staking) and withdrawal.
 *
 * vTokens are ERC-4626 vaults:
 *   - deposit(assets, receiver) → shares
 *   - withdraw(assets, receiver, owner) → shares
 *   - redeem(shares, receiver, owner) → assets
 */

export const VESU_VTOKEN_ABI = [
  {
    type: "function",
    name: "deposit",
    inputs: [
      { name: "assets", type: "core::integer::u256" },
      { name: "receiver", type: "core::starknet::contract_address::ContractAddress" },
    ],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "external",
  },
  {
    type: "function",
    name: "withdraw",
    inputs: [
      { name: "assets", type: "core::integer::u256" },
      { name: "receiver", type: "core::starknet::contract_address::ContractAddress" },
      { name: "owner", type: "core::starknet::contract_address::ContractAddress" },
    ],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "external",
  },
  {
    type: "function",
    name: "redeem",
    inputs: [
      { name: "shares", type: "core::integer::u256" },
      { name: "receiver", type: "core::starknet::contract_address::ContractAddress" },
      { name: "owner", type: "core::starknet::contract_address::ContractAddress" },
    ],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "external",
  },
  {
    type: "function",
    name: "max_deposit",
    inputs: [
      { name: "receiver", type: "core::starknet::contract_address::ContractAddress" },
    ],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "max_withdraw",
    inputs: [
      { name: "owner", type: "core::starknet::contract_address::ContractAddress" },
    ],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "convert_to_shares",
    inputs: [{ name: "assets", type: "core::integer::u256" }],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "convert_to_assets",
    inputs: [{ name: "shares", type: "core::integer::u256" }],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
] as const;
