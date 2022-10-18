import { PublicKey, UInt64 } from 'snarkyjs';
import { HTLCPoseidon, HTLCPoseidonConcrete } from './HTLCPoseidon';

export class HTLCPoseidonNative
  extends HTLCPoseidon
  implements HTLCPoseidonConcrete
{
  depositIntoSelf(from: PublicKey, amount: UInt64) {
    this.balance.addInPlace(amount);
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
