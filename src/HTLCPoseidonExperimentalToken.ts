import { PrivateKey, PublicKey, UInt64 } from 'snarkyjs';
import { HTLCPoseidon, HTLCPoseidonConcrete } from './HTLCPoseidon';
import { TokenContract } from './TokenContract';

export class HTLCPoseidonExperimentalToken
  extends HTLCPoseidon
  implements HTLCPoseidonConcrete
{
  // TODO: add a constructor argument to provide this address instead
  public tokenContractAddress: PublicKey = PrivateKey.random().toPublicKey();
  // public tokenContractAddress: PublicKey;

  transfer(from: PublicKey, to: PublicKey, amount: UInt64) {
    const tokenContract = new TokenContract(this.tokenContractAddress);
    tokenContract.transfer(from, to, amount);
  }

  depositIntoSelf(from: PublicKey, amount: UInt64): void {
    this.transfer(from, this.address, amount);
  }

  // eslint-disable-next-line
  withdrawFromSelfTo(to: PublicKey): void {
    const currentBalance = this.account.balance.get();
    // assert balance is equal at time of execution
    this.account.balance.assertEquals(currentBalance);
    // empty out the contract completely
    this.balance.subInPlace(currentBalance);
  }
}
