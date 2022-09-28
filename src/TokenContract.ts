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
  SUPPLY = UInt64.from(10n ** 18n);

  deploy(args?: DeployArgs) {
    super.deploy(args);
    this.setPermissions({
      ...Permissions.default(),
      send: Permissions.proofOrSignature(),
    });
  }
  @method init() {
    // mint the entire supply to the token account with the same address as this contract
    let address = this.self.body.publicKey;
    let receiver = this.experimental.token.mint({
      address,
      amount: this.SUPPLY,
    });
    // assert that the receiving account is new, so this can be only done once
    receiver.account.isNew.assertEquals(Bool(true));
    // pay fees for opened account
    this.balance.subInPlace(Mina.accountCreationFee());
  }

  // this is a very standardized deploy method. instead, we could also take the account update from a callback
  // => need callbacks for signatures
  @method deployZkapp(address: PublicKey) {
    let tokenId = this.experimental.token.id;
    let zkapp = Experimental.createChildAccountUpdate(
      this.self,
      address,
      tokenId
    );
    AccountUpdate.setValue(zkapp.update.permissions, {
      ...Permissions.default(),
      send: Permissions.proof(),
    });
    // TODO pass in verification key --> make it a circuit value --> make circuit values able to hold auxiliary data
    // AccountUpdate.setValue(zkapp.update.verificationKey, verificationKey);
    zkapp.sign();
  }

  // let a zkapp do whatever it wants, as long as the token supply stays constant
  @method authorize(callback: Experimental.Callback<any>) {
    let layout = [[3, 0, 0], 0, 0]; // these are 10 child account updates we allow, in a left-biased tree of width 3
    // TODO: this should also return what the callback returns, and authorize should pass it on!
    let zkappUpdate = Experimental.accountUpdateFromCallback(
      this,
      layout,
      callback
    );
    // walk account updates to see if balances for this token cancel
    let balance = balanceSum(zkappUpdate, this.experimental.token.id);
    balance.assertEquals(Int64.zero);
  }

  @method transfer(from: PublicKey, to: PublicKey, value: UInt64) {
    this.experimental.token.send({ from, to, amount: value });
  }
}
