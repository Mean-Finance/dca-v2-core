import { deployments } from 'hardhat';
import { run } from 'hardhat';

async function main() {
  await verify({
    name: 'PermissionsManager',
    path: 'contracts/DCAPermissionsManager/DCAPermissionsManager.sol:DCAPermissionsManager',
  });

  await verify({
    name: 'DCAHub',
    path: 'contracts/DCAHub/DCAHub.sol:DCAHub',
  });
}

async function verify({ name, path }: { name: string; path: string }) {
  const contract = await deployments.getOrNull(name);
  try {
    await run('verify:verify', {
      address: contract!.address,
      constructorArguments: contract!.args,
      contract: path,
    });
  } catch (e: any) {
    if (!e.message.toLowerCase().includes('already verified')) {
      throw e;
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
