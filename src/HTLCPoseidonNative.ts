import { AccountUpdate, PublicKey, UInt64 } from 'snarkyjs';
import { HTLCPoseidon, HTLCPoseidonConcrete } from './HTLCPoseidon';

export class HTLCPoseidonNative
  extends HTLCPoseidon
  implements HTLCPoseidonConcrete
{
  depositIntoSelf(from: PublicKey, amount: UInt64) {
    // create an account update for 'from'
    const accountUpdate = AccountUpdate.create(from);
    // sub balance of refundTo with 'amount'
    accountUpdate.balance.subInPlace(amount);
    this.balance.addInPlace(amount);
    // applies a lazy signature a.k.a. to be signed later / outside of the contract
    accountUpdate.sign();
  }

  withdrawFromSelfTo(address: PublicKey) {
    const currentBalance = this.account.balance.get();
    // assert balance is equal at time of execution
    this.account.balance.assertEquals(currentBalance);
    // empty out the contract completely
    this.send({
      to: address,
      amount: currentBalance,
    });
  }
}
