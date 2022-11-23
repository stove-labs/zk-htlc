import { isReady, Mina, Poseidon, PrivateKey, UInt64 } from 'snarkyjs';
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

describe('HTLCPoseidonNative', () => {
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
    const amount = UInt64.from(300000000);
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
      context.contractInstance.lock(
        vars.refundTo,
        vars.recipient,
        vars.amount,
        vars.hashlock,
        vars.expireAt
      );
    });

    // refundTo needs to sign so the contract can transfer funds on its behalf
    tx.sign([refundToPrivateKey]);

    await tx.prove();
    await tx.send();

    console.log(
      'after lock',
      context.contractInstance.account.nonce.get().toString()
    );
  };

  const unlock = async (vars: ReturnType<typeof variables>) => {
    console.log(
      'before unlock',
      context.contractInstance.account.nonce.get().toString()
    );
    const tx = await Mina.transaction(context.feePayer, () => {
      context.contractInstance.unlock(vars.secret);
    });

    tx.sign([recipientPrivateKey]);

    await tx.prove();
    await tx.send();
  };

  const refund = async () => {
    const tx = await Mina.transaction(context.feePayer, () => {
      context.contractInstance.refund();
    });

    await tx.prove();
    await tx.send();
  };

  describe('lock', () => {
    it('should create a lock', async () => {
      const vars = variables();

      console.log(
        'before lock',
        context.contractInstance.account.nonce.get().toString()
      );

      await lock(vars);

      const contractBalance = Mina.getBalance(
        context.zkAppPrivateKey.toPublicKey()
      );
      console.log('contractBalance', contractBalance.toString());
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

        console.log(
          'account ready',
          Mina.getBalance(vars.recipient).toString()
        );

        console.log(
          'before unlock',
          context.contractInstance.account.nonce.get().toString()
        );
        await unlock(vars);

        const recipientBalance = Mina.getBalance(vars.recipient);
        recipientBalance.assertEquals(vars.amount);

        const contractBalance = Mina.getBalance(
          context.zkAppPrivateKey.toPublicKey()
        );
        contractBalance.assertEquals(UInt64.from(0));
      });
    });

    describe('refund', () => {
      it('should refund locked funds', async () => {
        const vars = variables();

        await refund();

        const refundToBalance = Mina.getBalance(vars.refundTo);
        refundToBalance.assertEquals(vars.amount);

        const contractBalance = Mina.getBalance(
          context.zkAppPrivateKey.toPublicKey()
        );
        contractBalance.assertEquals(UInt64.from(0));
      });
    });
  });
});
