import {
  Experimental,
  isReady,
  Mina,
  Poseidon,
  PrivateKey,
  UInt64,
} from 'snarkyjs';
import {
  deploy,
  deployToken,
  fundAddress,
  setupLocalMinaBlockchain,
  transferTo,
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

describe('HTLCPoseidonExperimentalToken', () => {
  let context = {} as TestContext;

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
        context.token.contractInstance,
        context.token.contractInstance.token.id
      )),
    };

    (
      context.contractInstance as HTLCPoseidonExperimentalToken
    ).tokenContractAddress = context.token.contractInstance.address;
  });

  const lock = async (vars: ReturnType<typeof variables>) => {
    // fund 'refundTo', so that it can receive tokens
    await fundAddress(context.feePayer, vars.refundTo);

    // send a creation fee amount fo refundTo, so it can pay for the contract's token account creation
    await transferTo(
      context.feePayer,
      vars.refundTo,
      Mina.accountCreationFee().mul(1)
    );

    // fund the lock creator account with custom tokens
    await transferTokenTo(
      context.token.contractInstance,
      context.zkAppPrivateKey,
      context.feePayer,
      context.token.zkAppPrivateKey,
      vars.refundTo,
      vars.amount,
      true // fund
    );

    console.log('locking');
    const tx = await Mina.transaction(context.feePayer, () => {
      const approvableCallback = Experimental.Callback.create(
        context.contractInstance,
        'lock',
        [
          vars.refundTo,
          vars.recipient,
          vars.amount,
          vars.hashlock,
          vars.expireAt,
        ]
      );

      context.token.contractInstance.approveTransferCallback(
        approvableCallback
      );
    });

    tx.sign([refundToPrivateKey]);

    console.log('proving');
    await tx.prove();

    console.log('sending');
    await tx.send();
  };

  const unlock = async (vars: ReturnType<typeof variables>) => {
    // fund the recipient so it can receive mina
    await fundAddress(context.feePayer, vars.recipient);

    await transferTokenTo(
      context.token.contractInstance,
      context.zkAppPrivateKey,
      context.feePayer,
      context.token.zkAppPrivateKey,
      vars.recipient,
      UInt64.from(0),
      true // fund
    );

    console.log('unlocking');
    const tx = await Mina.transaction(context.feePayer, () => {
      context.contractInstance.unlock(vars.secret);
      context.token.contractInstance.approveUpdateAndSend(
        context.contractInstance.self,
        vars.recipient,
        vars.amount
      );
    });

    tx.sign([recipientPrivateKey]);

    console.log('unlock tx');
    console.log(tx.toPretty());

    await tx.prove();
    await tx.send();
  };

  const refund = async (vars: ReturnType<typeof variables>) => {
    await fundAddress(context.feePayer, vars.recipient);

    await transferTokenTo(
      context.token.contractInstance,
      context.zkAppPrivateKey,
      context.feePayer,
      context.token.zkAppPrivateKey,
      vars.recipient,
      UInt64.from(0),
      true // fund
    );

    const tx = await Mina.transaction(context.feePayer, () => {
      context.contractInstance.refund();
      context.token.contractInstance.approveUpdateAndSend(
        context.contractInstance.self,
        vars.refundTo,
        vars.amount
      );
    });

    await tx.prove();
    await tx.send();
  };

  describe('lock', () => {
    it('should create a lock', async () => {
      const vars = variables();

      const contractBalanceBefore = Mina.getBalance(
        context.zkAppPrivateKey.toPublicKey(),
        context.token.contractInstance.token.id
      );
      console.log('contractBalanceBefore', contractBalanceBefore.toString());
      console.log('accounts', {
        tokenContract: context.token.contractInstance.address.toBase58(),
        htlcContract: context.contractInstance.address.toBase58(),
        refundTo: vars.refundTo.toBase58(),
      });
      await lock(vars);
      console.log('asserting contract balance');
      const contractBalance = Mina.getBalance(
        context.zkAppPrivateKey.toPublicKey(),
        context.token.contractInstance.token.id
      );
      contractBalance.assertEquals(vars.amount);

      console.log('asserting refundTo');
      const refundToBalance = Mina.getBalance(
        vars.refundTo,
        context.token.contractInstance.token.id
      );
      refundToBalance.assertEquals(UInt64.from(0));

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

        console.log('accounts', {
          token: context.token.contractInstance.address.toBase58(),
          htlc: context.contractInstance.address.toBase58(),
          recipient: recipientPrivateKey.toPublicKey().toBase58(),
        });

        console.log('debug before', {
          htlc: {
            balance: Mina.getBalance(
              context.zkAppPrivateKey.toPublicKey(),
              context.token.contractInstance.token.id
            ).toString(),
            address: context.contractInstance.address.toBase58(),
          },
        });

        await unlock(vars);

        console.log('debug after', {
          htlc: {
            tokenId: context.token.contractInstance.token.id.toString(),
            balance: Mina.getBalance(
              context.zkAppPrivateKey.toPublicKey(),
              context.token.contractInstance.token.id
            ).toString(),
            address: context.contractInstance.address.toBase58(),
          },
          recipient: {
            balance: Mina.getBalance(
              vars.recipient,
              context.token.contractInstance.token.id
            ).toString(),
            address: vars.recipient.toBase58(),
          },
        });

        const recipientBalance = Mina.getBalance(
          vars.recipient,
          context.token.contractInstance.token.id
        );
        console.log('recipientBalance', recipientBalance.toString());
        recipientBalance.assertEquals(vars.amount);

        const contractBalance = Mina.getBalance(
          context.zkAppPrivateKey.toPublicKey(),
          context.token.contractInstance.token.id
        );
        contractBalance.assertEquals(UInt64.from(0));
      });
    });

    describe('refund', () => {
      it('should refund locked funds', async () => {
        const vars = variables();

        await refund(vars);

        const recipientBalance = Mina.getBalance(
          vars.refundTo,
          context.token.contractInstance.token.id
        );
        recipientBalance.assertEquals(vars.amount);

        const contractBalance = Mina.getBalance(
          context.zkAppPrivateKey.toPublicKey(),
          context.token.contractInstance.token.id
        );
        contractBalance.assertEquals(UInt64.from(0));
      });
    });
  });
});
