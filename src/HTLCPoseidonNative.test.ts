import {
  AccountUpdate,
  isReady,
  Mina,
  Poseidon,
  PrivateKey,
  UInt64,
} from 'snarkyjs';
import { deploy, setupLocalMinaBlockchain } from './helpers';
import { Recipient, Secret } from './HTLCPoseidon';
import { HTLCPoseidonNative } from './HTLCPoseidonNative';
import { addDays } from './UInt64Helpers';

const recipientPublicKey = PrivateKey.random().toPublicKey();

describe('HTLCPoseidonNative', () => {
  let feePayer: PrivateKey;
  let contractInstance: HTLCPoseidonNative;
  let zkAppPrivateKey: PrivateKey;

  // beforeAll since the tests are consequtive
  beforeAll(async () => {
    await isReady;
    ({ feePayer } = setupLocalMinaBlockchain());
    ({ contractInstance, zkAppPrivateKey } = await deploy(feePayer));
    // console.log('compiling');
    // console.time('compile');
    // await HTLCPoseidonNative.compile();
    // console.timeEnd('compile');
  });

  // we need to wrap it into a function like this due to await isReady
  // could be `let` variables + beforeAll intead of a function
  const variables = () => {
    // create a secret
    const secret = Secret.fromUInt64(UInt64.MAXINT());
    const hashlock = Poseidon.hash(secret.value);
    const timestamp = Mina.getNetworkState().timestamp;
    const expireAt = addDays(timestamp, 4);
    const amount = UInt64.fromNumber(300000000);
    const recipient = Recipient.fromPublicKey(recipientPublicKey);

    return { secret, hashlock, timestamp, expireAt, amount, recipient };
  };

  describe('lock', () => {
    it('should create a lock', async () => {
      const vars = variables();
      // forge an operation to call the contract
      const tx = await Mina.transaction(feePayer, () => {
        const accountUpdate = AccountUpdate.createSigned(feePayer);
        accountUpdate.balance.subInPlace(vars.amount);
        contractInstance.lock(
          vars.recipient,
          vars.amount,
          vars.hashlock,
          vars.expireAt
        );
        // sign to satisfy permission proofOrSignature
        contractInstance.sign(zkAppPrivateKey);
      });

      // TODO: .wait() triggers 'Invalid_fee_excess'
      tx.send();

      const contractBalance = Mina.getBalance(zkAppPrivateKey.toPublicKey());
      contractBalance.assertEquals(vars.amount);

      const currentHashlock = contractInstance.hashlock.get();
      currentHashlock.assertEquals(Poseidon.hash(vars.secret.value));

      const currentRecipient = contractInstance.recipient.get();
      currentRecipient.assertEquals(vars.recipient);
    });
  });

  // TODO: fix account update issues
  describe('unlock', () => {
    it('should unlock locked funds', async () => {
      const vars = variables();

      const fundRecipientTx = await Mina.transaction(feePayer, () => {
        const accountUpdate = AccountUpdate.createSigned(feePayer);
        accountUpdate.send({
          to: vars.recipient.toPublicKey(),
          // send 0 to the recipient
          amount: 0,
        });
        // subtract account creation fee from the feePayer
        accountUpdate.balance.subInPlace(1000000000);
      });

      fundRecipientTx.send();

      // TODO: figure out why this fails with `Invalid_fee_excess`
      const tx = await Mina.transaction(feePayer, () => {
        contractInstance.unlock(vars.secret);
        // sign to satisfy permission proofOrSignature
        contractInstance.sign(zkAppPrivateKey);
      });

      tx.send();

      // TODO: assert
      const recipientBalance = Mina.getBalance(vars.recipient.toPublicKey());
      recipientBalance.assertEquals(vars.amount);

      const contractBalance = Mina.getBalance(zkAppPrivateKey.toPublicKey());
      contractBalance.assertEquals(UInt64.fromNumber(0));
    });
  });
});
