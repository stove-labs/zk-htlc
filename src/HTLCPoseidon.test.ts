import { isReady, Mina, Poseidon, PrivateKey, UInt64 } from 'snarkyjs';
import { deploy, setupLocalMinaBlockchain } from './helpers';
import { HTLCPoseidon, Secret } from './HTLCPoseidon';
import { addDays } from './UInt64Helpers';

describe('HTLCPoseidon', () => {
  let feePayer: PrivateKey;
  let contractInstance: HTLCPoseidon;
  let zkAppPrivateKey: PrivateKey;

  beforeEach(async () => {
    await isReady;
    ({ feePayer } = setupLocalMinaBlockchain());
    ({ contractInstance, zkAppPrivateKey } = await deploy(feePayer));
  });

  describe('lock', () => {
    it('should update the hashlock using the provided secret', async () => {
      // create a secret
      const secret = Secret.fromUInt64(UInt64.MAXINT());
      const timestamp = Mina.getNetworkState().timestamp;
      const expireAt = addDays(timestamp, 4);
      console.log('expireAtR', expireAt.toString());
      // forge an operation to call the contract
      const tx = await Mina.transaction(feePayer, () => {
        contractInstance.deposit(secret, expireAt);
        // sign to satisfy permission proofOrSignature
        contractInstance.sign(zkAppPrivateKey);
      });

      tx.send();

      const hashlock = contractInstance.hashlock.get();
      hashlock.assertEquals(Poseidon.hash(secret.value));
    });
  });
});
