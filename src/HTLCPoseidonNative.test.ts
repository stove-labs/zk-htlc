import {
  AccountUpdate,
  isReady,
  Mina,
  Poseidon,
  PrivateKey,
  UInt64,
} from 'snarkyjs';
import {
  deploy,
  fundAddress,
  setupLocalMinaBlockchain,
  transferTo,
} from './helpers';
import { HTLCPoseidon, Secret } from './HTLCPoseidon';
import { HTLCPoseidonNative } from './HTLCPoseidonNative';
import { addDays } from './UInt64Helpers';

const recipientPrivateKey = PrivateKey.random();
const refundToPrivateKey = PrivateKey.random();

export interface TestContext {
  feePayer: PrivateKey;
  contractInstance: HTLCPoseidon;
  zkAppPrivateKey: PrivateKey;
}

describe.only('HTLCPoseidonNative', () => {
  let context = {} as TestContext;

  // beforeAll since the tests are consequtive
  beforeEach(async () => {
    await isReady;
    context.feePayer = setupLocalMinaBlockchain().feePayer;
    context = {
      ...context,
      ...(await deploy(context.feePayer, HTLCPoseidonNative)),
    };
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
    const recipient = recipientPrivateKey.toPublicKey();
    const refundTo = refundToPrivateKey.toPublicKey();
    return {
      secret,
      hashlock,
      timestamp,
      expireAt,
      amount,
      recipient,
      refundTo,
    };
  };

  const lock = async (vars: ReturnType<typeof variables>) => {
    // refundTo = person locking the funds, potentially eligible for a refund later
    await fundAddress(context.feePayer, vars.refundTo);
    await transferTo(context.feePayer, vars.refundTo, vars.amount);

    const tx = await Mina.transaction(context.feePayer, () => {
      const accountUpdate = AccountUpdate.createSigned(refundToPrivateKey);
      accountUpdate.balance.subInPlace(vars.amount);
      context.contractInstance.lock(
        vars.refundTo,
        vars.recipient,
        vars.amount,
        vars.hashlock,
        vars.expireAt
      );
      // sign to satisfy permission proofOrSignature
      context.contractInstance.sign(context.zkAppPrivateKey);
    });

    // TODO: .wait() triggers 'Invalid_fee_excess'
    tx.send();
  };

  const unlock = async (secret: Secret) => {
    const tx = await Mina.transaction(context.feePayer, () => {
      context.contractInstance.unlock(secret);
      // sign to satisfy permission proofOrSignature
      context.contractInstance.sign(context.zkAppPrivateKey);
    });

    tx.send();
  };

  const refund = async () => {
    const tx = await Mina.transaction(context.feePayer, () => {
      context.contractInstance.refund();
      // sign to satisfy permission proofOrSignature
      context.contractInstance.sign(context.zkAppPrivateKey);
    });

    tx.send();
  };

  describe('lock', () => {
    it('should create a lock', async () => {
      const vars = variables();

      await lock(vars);

      const contractBalance = Mina.getBalance(
        context.zkAppPrivateKey.toPublicKey()
      );
      contractBalance.assertEquals(vars.amount);

      const currentHashlock = context.contractInstance.hashlock.get();
      currentHashlock.assertEquals(Poseidon.hash(vars.secret.value));

      const currentRecipient = context.contractInstance.recipient.get();
      currentRecipient.assertEquals(vars.recipient);
    });
  });

  describe('with lock', () => {
    beforeEach(async () => {
      const vars = variables();
      await lock(vars);
    });

    describe('unlock', () => {
      it('should unlock locked funds', async () => {
        const vars = variables();

        await fundAddress(context.feePayer, vars.recipient);

        await unlock(vars.secret);

        const recipientBalance = Mina.getBalance(vars.recipient);
        recipientBalance.assertEquals(vars.amount);

        const contractBalance = Mina.getBalance(
          context.zkAppPrivateKey.toPublicKey()
        );
        contractBalance.assertEquals(UInt64.fromNumber(0));
      });
    });

    describe('refund', () => {
      it('should refund locked funds', async () => {
        const vars = variables();

        await refund();

        const recipientBalance = Mina.getBalance(vars.refundTo);
        recipientBalance.assertEquals(vars.amount);

        const contractBalance = Mina.getBalance(
          context.zkAppPrivateKey.toPublicKey()
        );
        contractBalance.assertEquals(UInt64.fromNumber(0));
      });
    });
  });
});
