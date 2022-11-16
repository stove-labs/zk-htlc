// borrowed from https://github.com/o1-labs/snarkyjs/src/examples/zkapps/dex/dex.ts

import {
  Bool,
  DeployArgs,
  Experimental,
  Int64,
  method,
  Mina,
  AccountUpdate,
  Permissions,
  PublicKey,
  SmartContract,
  UInt64,
  Circuit,
  Field,
  VerificationKey,
} from 'snarkyjs';

/**
 * Sum of balances of the account update and all its descendants
 */
function balanceSum(accountUpdate: AccountUpdate, tokenId: Field) {
  let myTokenId = accountUpdate.body.tokenId;
  let myBalance = Int64.fromObject(accountUpdate.body.balanceChange);
  let balance = Circuit.if(myTokenId.equals(tokenId), myBalance, Int64.zero);
  for (let child of accountUpdate.children.accountUpdates) {
    balance.add(balanceSum(child, tokenId));
  }
  return balance;
}

export class TokenContract extends SmartContract {
  // constant supply
  SUPPLY = UInt64.from(Mina.accountCreationFee().mul(10));

  deploy(args?: DeployArgs) {
    super.deploy(args);
    this.setPermissions({
      ...Permissions.default(),
      send: Permissions.proofOrSignature(),
    });
  }
  @method initSupply() {
    // mint the entire supply to the token account with the same address as this contract
    let address = this.self.body.publicKey;
    let receiver = this.token.mint({
      address,
      amount: this.SUPPLY,
    });
    // assert that the receiving account is new, so this can be only done once
    // receiver.account.isNew.assertEquals(Bool(true));
    // pay fees for opened account
    this.balance.subInPlace(Mina.accountCreationFee());
  }

  // // this is a very standardized deploy method. instead, we could also take the account update from a callback
  // // => need callbacks for signatures
  // @method deployZkapp(address: PublicKey) {
  //   let tokenId = this.token.id;
  //   let zkapp = Experimental.createChildAccountUpdate(
  //     this.self,
  //     address,
  //     tokenId
  //   );
  //   AccountUpdate.setValue(zkapp.update.permissions, {
  //     ...Permissions.default(),
  //     send: Permissions.proof(),
  //   });
  //   // TODO pass in verification key --> make it a circuit value --> make circuit values able to hold auxiliary data
  //   // AccountUpdate.setValue(zkapp.update.verificationKey, verificationKey);
  //   zkapp.sign();
  // }

  @method approveZkapp(zkappUpdate: AccountUpdate) {
    this.approve(zkappUpdate);
    // return {} as any;
    // let balanceChange = Int64.fromObject(zkappUpdate.body.balanceChange);
    // balanceChange.assertEquals(Int64.from(0));
  }

  @method approveZkapp2(zkappUpdate: AccountUpdate) {
    this.approve(zkappUpdate);
    // return {} as any;
    // let balanceChange = Int64.fromObject(zkappUpdate.body.balanceChange);
    // balanceChange.assertEquals(Int64.from(0));
  }

  // // let a zkapp do whatever it wants, as long as the token supply stays constant
  // @method authorize(callback: Experimental.Callback<any>) {
  //   let layout = [[3, 0, 0], 0, 0]; // these are 10 child account updates we allow, in a left-biased tree of width 3
  //   // TODO: this should also return what the callback returns, and authorize should pass it on!
  //   let zkappUpdate = Experimental.accountUpdateFromCallback(
  //     this,
  //     layout,
  //     callback
  //   );
  //   // walk account updates to see if balances for this token cancel
  //   let balance = balanceSum(zkappUpdate, this.token.id);
  //   balance.assertEquals(Int64.zero);
  // }

  // TODO: check account update balance changes do not mint any tokens
  @method approveTransferCallback(callback: Experimental.Callback<any>) {
    const layout = AccountUpdate.Layout.AnyChildren;
    console.log('approving');
    const approvedAccountUpdate = this.approve(callback, layout);
    // console.log('approved', approved.body.balanceChange.magnitude.toString());
    const balanceChange = Int64.fromObject(
      approvedAccountUpdate.body.balanceChange
    );
    balanceChange.assertEquals(Int64.from(0));
  }

  @method approveUpdateAndSend(
    zkappUpdate: AccountUpdate,
    to: PublicKey,
    amount: UInt64
  ) {
    this.approve(zkappUpdate);

    // see if balance change cancels the amount sent
    let balanceChange = Int64.fromObject(zkappUpdate.body.balanceChange);
    balanceChange.assertEquals(Int64.from(amount).neg());
    // add same amount of tokens to the receiving address
    console.log('minting', {
      to: to.toBase58(),
      amount: amount.toString(),
    });
    this.token.mint({ address: to, amount });
  }

  @method transfer(
    from: PublicKey,
    to: PublicKey,
    value: UInt64
  ): AccountUpdate {
    return this.token.send({ from, to, amount: value });
  }

  @method mint(to: PublicKey, value: UInt64) {
    this.token.mint({ address: to, amount: value });
  }

  @method burn(from: PublicKey, value: UInt64) {
    this.token.burn({ address: from, amount: value });
  }
}
