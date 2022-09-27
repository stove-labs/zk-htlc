import { AccountUpdate, Mina, PrivateKey } from 'snarkyjs';
import { HTLCPoseidonNative } from './HTLCPoseidonNative';

export const setupLocalMinaBlockchain = () => {
  const localInstance = Mina.LocalBlockchain();
  Mina.setActiveInstance(localInstance);
  const feePayer = localInstance.testAccounts[0].privateKey;
  return { feePayer };
};

// just for the info
export const feePayerInitialBalance = 30000000000;
export const contractInitialBalance = 1000;
export const deploy = async (feePayer: PrivateKey) => {
  const zkAppPrivateKey = PrivateKey.random();
  const contractInstance = new HTLCPoseidonNative(
    zkAppPrivateKey.toPublicKey()
  );

  // forge a deployment transaction
  const tx = await Mina.transaction(feePayer, () => {
    // fund the fee payer account
    AccountUpdate.fundNewAccount(feePayer);
    // deploy the contract
    contractInstance.deploy({ zkappKey: zkAppPrivateKey });
    // sign it, since we are not using proofs
    contractInstance.sign(zkAppPrivateKey);
  });

  tx.send();

  return { contractInstance, zkAppPrivateKey };
};
