import { AccountUpdate, PublicKey, UInt64 } from 'snarkyjs';
import { HTLCPoseidon, HTLCPoseidonConcrete } from './HTLCPoseidon';

export class HTLCPoseidonNative
  extends HTLCPoseidon
  implements HTLCPoseidonConcrete
{
  depositIntoSelf(from: PublicKey, amount: UInt64): AccountUpdate {
    const accountUpdate = AccountUpdate.create(from);
    // TODO: how to sign this outside of the tx, so that the account update can be moved to the contract method?
    // sub balance of refundTo with 'amount'
    accountUpdate.balance.subInPlace(amount);
    this.balance.addInPlace(amount);
    return accountUpdate;
  }

  withdrawFromSelfTo(address: PublicKey) {
    const currentBalance = this.account.balance.get();
    // assert balance is equal at time of execution
    this.account.balance.assertEquals(currentBalance);
    console.log('withdrawFromSelfTo', address.toBase58());
    // empty out the contract completely
    this.send({
      to: address,
      amount: currentBalance,
    });
  }
}
