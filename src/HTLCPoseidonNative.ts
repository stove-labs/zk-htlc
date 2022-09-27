import { UInt64 } from 'snarkyjs';
import { HTLCPoseidon, HTLCPoseidonConcrete, Recipient } from './HTLCPoseidon';

export class HTLCPoseidonNative
  extends HTLCPoseidon
  implements HTLCPoseidonConcrete
{
  depositIntoSelf(amount: UInt64) {
    this.balance.addInPlace(amount);
  }

  withdrawFromSelfToRecipient(recipient: Recipient) {
    const currentBalance = this.account.balance.get();
    // assert balance is equal at time of execution
    this.account.balance.assertEquals(currentBalance);
    // empty out the contract completely
    this.send({
      to: recipient.toPublicKey(),
      amount: currentBalance,
    });
  }
}
