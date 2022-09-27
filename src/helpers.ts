import { AccountUpdate, Mina, PrivateKey } from 'snarkyjs';
import { HTLCPoseidon } from './HTLCPoseidon';

export const setupLocalMinaBlockchain = () => {
  console.log('setting up local blockchain');
  const localInstance = Mina.LocalBlockchain();
  Mina.setActiveInstance(localInstance);
  const feePayer = localInstance.testAccounts[0].privateKey;
  return { feePayer };
};

export const deploy = async (feePayer: PrivateKey) => {
  const zkAppPrivateKey = PrivateKey.random();
  const contractInstance = new HTLCPoseidon(zkAppPrivateKey.toPublicKey());
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
