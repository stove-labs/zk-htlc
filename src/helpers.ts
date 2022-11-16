import {
  AccountUpdate,
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  UInt64,
} from 'snarkyjs';
import { HTLCPoseidonExperimentalToken } from './HTLCPoseidonExperimentalToken';
import { HTLCPoseidonNative } from './HTLCPoseidonNative';
import { TokenContract } from './TokenContract';

export const setupLocalMinaBlockchain = () => {
  const localInstance = Mina.LocalBlockchain({
    proofsEnabled: false,
  });
  Mina.setActiveInstance(localInstance);
  const feePayer = localInstance.testAccounts[0].privateKey;
  return { feePayer };
};

// just for the info
export const feePayerInitialBalance = 30000000000;
export const contractInitialBalance = 1000;
export const deploy = async (
  feePayer: PrivateKey,
  concreteContract:
    | typeof HTLCPoseidonNative
    | typeof HTLCPoseidonExperimentalToken,
  tokenContract?: TokenContract,
  tokenId?: Field
) => {
  const zkAppPrivateKey = PrivateKey.random();
  const contractInstance = new concreteContract(
    zkAppPrivateKey.toPublicKey(),
    tokenId
  );

  console.log('zkapp tokenId', {
    tokenId: tokenId?.toString(),
    contractInstanceTokenId: contractInstance.tokenId.toString(),
  });

  Error.stackTraceLimit = 1000;
  try {
    // tokenContract && (await concreteContract.compile());
  } catch (e) {
    console.error('compile error');
    console.error(e);
  }

  console.log('deploying with app token', tokenId?.toString());

  // forge a deployment transaction
  const tx = await Mina.transaction(feePayer, async () => {
    // fund the fee payer account
    AccountUpdate.fundNewAccount(feePayer);
    // deploy the contract
    contractInstance.deploy({ zkappKey: zkAppPrivateKey });
    // sign it, since we are not using proofs
    contractInstance.sign(zkAppPrivateKey);

    // token contract approves the deployment account update
    tokenContract && tokenContract.approveZkapp(contractInstance.self);
  });

  console.log('deploy account updates', tx.transaction.accountUpdates);

  tx.sign([zkAppPrivateKey]);

  try {
    await tx.prove();
    await tx.send();
  } catch (e) {
    console.error('deploy + approve error');
    console.error(e);
  }

  return { contractInstance, zkAppPrivateKey };
};

// TODO: this is probably redundant and we should use .fundNewAccount instead
export const fundAddress = async (feePayer: PrivateKey, address: PublicKey) => {
  const fundRecipientTx = await Mina.transaction(feePayer, () => {
    const accountUpdate = AccountUpdate.createSigned(feePayer);
    accountUpdate.send({
      to: address,
      // send 0 to the recipient or actually let the address also fund one account
      amount: 0,
    });
    // subtract account creation fee + amount from the feePayer
    accountUpdate.balance.subInPlace(Mina.accountCreationFee());
  });

  await fundRecipientTx.prove();
  await fundRecipientTx.send();
};

export const transferTo = async (
  feePayer: PrivateKey,
  address: PublicKey,
  amount: UInt64
) => {
  console.log('transferTo', {
    from: feePayer.toPublicKey().toBase58(),
    to: address.toBase58(),
    amount: amount.toString(),
  });
  const transferToTx = await Mina.transaction(feePayer, () => {
    const accountUpdate = AccountUpdate.createSigned(feePayer);
    accountUpdate.send({
      to: address,
      // send 0 to the recipient or actually let the address also fund one account
      amount,
    });
  });

  await transferToTx.prove();

  await transferToTx.send();
  console.log('transferTo', 'done');
};

export const transferTokenTo = async (
  contractInstance: TokenContract,
  zkAppPrivateKey: PrivateKey,
  feePayer: PrivateKey,
  from: PrivateKey,
  to: PublicKey,
  amount: UInt64,
  fund?: boolean
) => {
  console.log('transferToken', {
    zkAppPublicKey: zkAppPrivateKey.toPublicKey().toBase58(),
    from: from.toPublicKey().toBase58(),
    to: to.toBase58(),
    amount: amount.toString(),
  });

  // send mina to the token contract, so that the token contract can pay for the creation fee
  if (fund) {
    await transferTo(feePayer, from.toPublicKey(), Mina.accountCreationFee());
  }

  let transferToTx = await Mina.transaction(feePayer, () => {
    if (fund) {
      const fromAccountUpdate = AccountUpdate.createSigned(from);
      fromAccountUpdate.balance.subInPlace(Mina.accountCreationFee());
    }

    contractInstance.transfer(from.toPublicKey(), to, amount);
  });

  // IMPORTANT!! .sign returns a new transaction, so we need to .send/.prove the new one
  transferToTx = transferToTx.sign([from]);
  await transferToTx.prove();

  await transferToTx.send();
  console.log('transferTokenTo successful');
};

export const deployToken = async (feePayer: PrivateKey) => {
  const zkAppPrivateKey = PrivateKey.random();
  const contractInstance = new TokenContract(zkAppPrivateKey.toPublicKey());

  console.log('accountCreationFee', Mina.accountCreationFee().toString());

  console.log('deploy token');
  // forge a deployment transaction
  const deployTx = await Mina.transaction(feePayer, () => {
    // fund the fee payer account
    AccountUpdate.fundNewAccount(feePayer);
    // deploy the contract
    contractInstance.deploy({ zkappKey: zkAppPrivateKey });
    // sign it, since we are not using proofs
    contractInstance.sign(zkAppPrivateKey);
  });

  await deployTx.send();

  /**
   * Token contract needs to hold MINA, in order to pay the creation fee
   * for minting its own custom token for its own address.
   */
  console.log('funding token contract');
  await transferTo(
    feePayer,
    contractInstance.address,
    Mina.accountCreationFee()
  );

  console.log('init token');
  const initTx = await Mina.transaction(feePayer, () => {
    // init the contract
    contractInstance.init();
    // sign it, since we are not using proofs
    contractInstance.sign(zkAppPrivateKey);
  });

  await initTx.send();

  console.log(
    'token contract deployed with balances',
    zkAppPrivateKey.toPublicKey().toBase58(),
    {
      token: {
        mina: Mina.getBalance(zkAppPrivateKey.toPublicKey()).toString(),
        [`${contractInstance.experimental.token.id}`]: Mina.getBalance(
          zkAppPrivateKey.toPublicKey(),
          contractInstance.experimental.token.id
        ).toString(),
      },
    }
  );

  return { contractInstance, zkAppPrivateKey };
};
