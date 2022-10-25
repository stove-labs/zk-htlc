import { Experimental, PublicKey, UInt64 } from 'snarkyjs';
import { HTLCPoseidon, HTLCPoseidonConcrete } from './HTLCPoseidon';

export class HTLCPoseidonExperimentalToken
  extends HTLCPoseidon
  implements HTLCPoseidonConcrete
{
  depositIntoSelf(from: PublicKey, amount: UInt64) {
    this.balance.addInPlace(amount);

    const fromAccountUpdate = Experimental.createChildAccountUpdate(
      this.self,
      from,
      this.experimental.token.id
    );

    fromAccountUpdate.balance.subInPlace(amount);
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
