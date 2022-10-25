import { isReady, Mina, Poseidon, PrivateKey, UInt64 } from 'snarkyjs';
import {
  deploy,
  deployToken,
  fundAddress,
  setupLocalMinaBlockchain,
  transferTokenTo,
} from './helpers';
import { HTLCPoseidon, Secret } from './HTLCPoseidon';
import { HTLCPoseidonExperimentalToken } from './HTLCPoseidonExperimentalToken';
import { TokenContract } from './TokenContract';
import { addDays } from './UInt64Helpers';

const recipientPrivateKey = PrivateKey.random();
const refundToPrivateKey = PrivateKey.random();

export interface TestContext {
  feePayer: PrivateKey;
  contractInstance: HTLCPoseidon;
  zkAppPrivateKey: PrivateKey;
  token: {
    contractInstance: TokenContract;
    zkAppPrivateKey: PrivateKey;
  };
}

describe.only('HTLCPoseidonExperimentalToken', () => {
  let context = {} as TestContext;

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

  // beforeAll since the tests are consequtive
  beforeEach(async () => {
    await isReady;
    context.feePayer = setupLocalMinaBlockchain().feePayer;
    context.token = await deployToken(context.feePayer);
    context = {
      ...context,
      ...(await deploy(
        context.feePayer,
        HTLCPoseidonExperimentalToken,
        context.token.contractInstance.experimental.token.id
      )),
    };
  });

  const lock = async (vars: ReturnType<typeof variables>) => {
    console.log('locking');
    const tx = await Mina.transaction(context.feePayer, () => {
      context.contractInstance.lock(
        vars.refundTo,
        vars.recipient,
        vars.amount,
        vars.hashlock,
        vars.expireAt
      );
      // // sign to satisfy permission proofOrSignature
      context.contractInstance.sign(context.zkAppPrivateKey);
    });
    // TODO CONTINUE HERE: figure out why:
    //  [[],[],[["Update_not_permitted_balance"],["Overflow"]]]
    tx.sign([refundToPrivateKey]);
    tx.send();
  };

  // const unlock = async (secret: Secret) => {
  //   const tx = await Mina.transaction(context.feePayer, () => {
  //     context.contractInstance.unlock(secret);
  //     // sign to satisfy permission proofOrSignature
  //     context.contractInstance.sign(context.zkAppPrivateKey);
  //   });

  //   tx.send();
  // };

  // const refund = async () => {
  //   const tx = await Mina.transaction(context.feePayer, () => {
  //     context.contractInstance.refund();
  //     // sign to satisfy permission proofOrSignature
  //     context.contractInstance.sign(context.zkAppPrivateKey);
  //   });

  //   tx.send();
  // };

  describe('lock', () => {
    it('should create a lock', async () => {
      const vars = variables();

      // fund 'refundTo', so that it can receive
      await fundAddress(context.feePayer, vars.refundTo);
      // await transferTo(
      //   context.feePayer,
      //   vars.refundTo,
      //   Mina.accountCreationFee().mul(5)
      // );

      // await transferTo(
      //   context.feePayer,
      //   context.zkAppPrivateKey.toPublicKey(),
      //   Mina.accountCreationFee().mul(5)
      // );

      console.log('balances refundTo', vars.refundTo.toBase58(), {
        token: {
          mina: Mina.getBalance(vars.refundTo).toString(),
        },
      });

      console.log(
        'balances app',
        context.zkAppPrivateKey.toPublicKey().toBase58(),
        context.contractInstance.experimental.token.id.toString(),
        {
          token: {
            mina: Mina.getBalance(
              context.zkAppPrivateKey.toPublicKey()
            ).toString(),
          },
        }
      );

      // fund the lock creator account with custom tokens
      await transferTokenTo(
        context.token.contractInstance,
        context.zkAppPrivateKey,
        context.feePayer,
        context.token.zkAppPrivateKey,
        vars.refundTo,
        vars.amount
      );

      // this is not required since refundTo is already existing on chain
      // await fundAddress(context.feePayer, vars.refundTo);

      console.log(
        'refundTo',
        context.zkAppPrivateKey.toPublicKey().toBase58(),
        {
          token: {
            mina: Mina.getBalance(vars.refundTo).toString(),
            [`${context.token.contractInstance.experimental.token.id.toString()}`]:
              Mina.getBalance(
                vars.refundTo,
                context.token.contractInstance.experimental.token.id
              ).toString(),
          },
        }
      );

      await lock(vars);
      const contractBalance = Mina.getBalance(
        context.zkAppPrivateKey.toPublicKey()
      );
      contractBalance.assertEquals(vars.amount);
      console.log('contract balance', contractBalance.toString());
      console.log(
        'refundTo',
        context.zkAppPrivateKey.toPublicKey().toBase58(),
        {
          token: {
            mina: Mina.getBalance(vars.refundTo).toString(),
            [`${context.token.contractInstance.experimental.token.id.toString()}`]:
              Mina.getBalance(
                vars.refundTo,
                context.token.contractInstance.experimental.token.id
              ).toString(),
          },
        }
      );
      // const currentHashlock = context.contractInstance.hashlock.get();
      // currentHashlock.assertEquals(Poseidon.hash(vars.secret.value));
      // const currentRecipient = context.contractInstance.recipient.get();
      // currentRecipient.assertEquals(vars.recipient);
    });
  });

  // describe('with lock', () => {
  //   beforeEach(async () => {
  //     const vars = variables();
  //     await lock(vars);
  //   });

  //   describe('unlock', () => {
  //     it('should unlock locked funds', async () => {
  //       const vars = variables();

  //       await fundAddress(context.feePayer, vars.recipient);

  //       await unlock(vars.secret);

  //       const recipientBalance = Mina.getBalance(vars.recipient);
  //       recipientBalance.assertEquals(vars.amount);

  //       const contractBalance = Mina.getBalance(
  //         context.zkAppPrivateKey.toPublicKey()
  //       );
  //       contractBalance.assertEquals(UInt64.fromNumber(0));
  //     });
  //   });

  //   describe('refund', () => {
  //     it('should refund locked funds', async () => {
  //       const vars = variables();

  //       await fundAddress(context.feePayer, vars.refundTo);

  //       await refund();

  //       const recipientBalance = Mina.getBalance(vars.refundTo);
  //       recipientBalance.assertEquals(vars.amount);

  //       const contractBalance = Mina.getBalance(
  //         context.zkAppPrivateKey.toPublicKey()
  //       );
  //       contractBalance.assertEquals(UInt64.fromNumber(0));
  //     });
  //   });
  // });
});
