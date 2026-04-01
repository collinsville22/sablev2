import { RpcProvider, Account, json, CallData } from "starknet";
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const RPC_URL = "https://rpc.starknet.lava.build";
const PRIVATE_KEY = "0x013f0a4a2a0cf75a68ae5be5cf21e7d24429ff1e5fcf06b6d702afdba4d8ff7a";
const ACCOUNT_ADDRESS = "0x0007842590942b769a203cfcb07540299b86e22ba05b6708b516ec04ca044ef7";
const SENTINEL_VAULT = "0x04ec7fdb16834e62a14e7741d28e1eaa8bb55e43b1e120bbd0e1dd2f44ebc653";
const WBTC_ADDRESS = "0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac";

function loadContract(basePath, name) {
  const sierra = json.parse(readFileSync(resolve(basePath, `${name}.contract_class.json`), "utf-8"));
  const casm = json.parse(readFileSync(resolve(basePath, `${name}.compiled_contract_class.json`), "utf-8"));
  return { sierra, casm };
}

async function declareAndDeploy(account, provider, sierra, casm, constructorCalldata, name) {
  console.log(`\n📦 Declaring ${name}...`);
  const declareRes = await account.declare({ contract: sierra, compiledClassHash: casm });
  console.log(`   Declare tx: ${declareRes.transaction_hash}`);
  await provider.waitForTransaction(declareRes.transaction_hash, { retryInterval: 5000 });
  console.log(`   ✅ Class hash: ${declareRes.class_hash}`);

  console.log(`🚀 Deploying ${name}...`);
  const deployRes = await account.deploy({ classHash: declareRes.class_hash, constructorCalldata });
  console.log(`   Deploy tx: ${deployRes.transaction_hash}`);
  await provider.waitForTransaction(deployRes.transaction_hash, { retryInterval: 5000 });
  const addr = Array.isArray(deployRes.contract_address) ? deployRes.contract_address[0] : deployRes.contract_address;
  console.log(`   ✅ Deployed: ${addr}`);
  return addr;
}

async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("  Sable V2 — Starknet Mainnet Deployment  ");
  console.log("═══════════════════════════════════════════\n");

  const provider = new RpcProvider({ nodeUrl: RPC_URL, requestTimeout: 120000 });
  const account = new Account({
    provider,
    address: ACCOUNT_ADDRESS,
    signer: { privateKey: PRIVATE_KEY },
  });

  console.log(`Account: ${account.address}`);
  const nonce = await provider.getNonceForAddress(account.address);
  console.log(`Nonce: ${nonce}`);

  const contractsDir = resolve(__dirname, "../contracts/target/dev");
  const verifierDir = resolve(__dirname, "../groth16_verifier_v5/target/dev");

  const deployed = {};

  {
    const { sierra, casm } = loadContract(verifierDir, "groth16_verifier_v5_Groth16VerifierBN254");
    deployed.verifier = await declareAndDeploy(account, provider, sierra, casm, [], "Groth16VerifierV5");
  }

  {
    const { sierra, casm } = loadContract(contractsDir, "btcvault_StealthRegistry");
    deployed.stealth = await declareAndDeploy(account, provider, sierra, casm, [], "StealthRegistry");
  }

  {
    const { sierra, casm } = loadContract(contractsDir, "btcvault_ASPRegistry");
    const calldata = CallData.compile({ owner: ACCOUNT_ADDRESS });
    deployed.asp = await declareAndDeploy(account, provider, sierra, casm, calldata, "ASPRegistry");
  }

  {
    const { sierra, casm } = loadContract(contractsDir, "btcvault_ShieldedPoolV5");
    const calldata = CallData.compile({
      asset: WBTC_ADDRESS,
      verifier: deployed.verifier,
      vault: SENTINEL_VAULT,
      owner: ACCOUNT_ADDRESS,
      max_deposit: { low: "1000000", high: "0" },
      min_deposit: { low: "1000", high: "0" },
    });
    deployed.pool = await declareAndDeploy(account, provider, sierra, casm, calldata, "ShieldedPoolV5");
  }

  console.log("\n═══════════════════════════════════════════");
  console.log("  DEPLOYMENT COMPLETE");
  console.log("═══════════════════════════════════════════");
  console.log(`  Verifier V5:     ${deployed.verifier}`);
  console.log(`  StealthRegistry: ${deployed.stealth}`);
  console.log(`  ASPRegistry:     ${deployed.asp}`);
  console.log(`  ShieldedPoolV5:  ${deployed.pool}`);
  console.log("═══════════════════════════════════════════\n");

  writeFileSync(resolve(__dirname, "../contracts/v5-deployed.json"), JSON.stringify(deployed, null, 2));
  console.log("Saved to contracts/v5-deployed.json");
}

main().catch(err => {
  console.error("\n❌ Failed:", err.message || err);
  process.exit(1);
});
