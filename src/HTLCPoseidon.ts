import {
  arrayProp,
  CircuitValue,
  DeployArgs,
  Field,
  method,
  Permissions,
  Poseidon,
  SmartContract,
  state,
  State,
  UInt64,
} from 'snarkyjs';
import { subDays } from './UInt64Helpers';

/**
 *  Single Field secret can fit 4x UInt64, since it can store 256bits
 */
export class Secret extends CircuitValue {
  @arrayProp(Field, 1) value: Field[];

  // pattern to allow expanding the secret to contain 4xUInt64
  static fromUInt64(a: UInt64): Secret {
    const secret = new Secret();
    // UInt64.toFields() gives us a single field in an array
    // once we add more than 1xUInt64 to the secret, we will handle the composition into arrayProp here
    secret.value = a.toFields();
    return secret;
  }
}

/**
 * Hash time lock contract using the Poseidon hashing function
 */
export class HTLCPoseidon extends SmartContract {
  @state(Field)
  hashlock: State<Field> = State<Field>();
  @state(UInt64)
  expireAt: State<UInt64> = State<UInt64>();
  /**
   * Expose secret through the storage, as it needs to be visible to the
   * second party in case the HTLC is used for an atomic swap.
   *
   * IMPORTANT: This only happens at release time, never at lock time.
   */
  @state(Secret)
  secret: State<Secret> = State<Secret>();

  assertNoHashlockExists() {
    const currentHashlock = this.hashlock.get();
    // precondition asserting data consistency between proving and verification
    this.hashlock.assertEquals(currentHashlock);
    // if there is a hashlock already, fail
    // TODO: is it necessary to assertEquals at the same time as assertNothing?
    this.hashlock.assertNothing();
  }

  assertExpiresAtInSufficientFuture(expireAt: UInt64) {
    const timestamp = this.network.timestamp.get();
    this.network.timestamp.assertEquals(timestamp);
    // assert that expiresAt is at least 3 days in the future
    // TODO: should we use absolute value for expireAt, or relative to timestamp?
    // e.g. expireAt = timestamp+expireAt

    const expireSubThreeDays = subDays(expireAt, 3);
    console.log('timelock', {
      expireSubThreeDays: expireSubThreeDays.toString(),
      expireAt: expireAt.toString(),
      timestamp: timestamp.toString(),
    });
    expireSubThreeDays.assertGt(timestamp);
  }

  setHashLock(secret: Secret) {
    const hashlock = Poseidon.hash(secret.value);
    this.hashlock.set(hashlock);
  }

  /**
   * Method to create a hash-time-locked deposit, as long as there isn't one already
   * @param secret Secret
   * @param expireAt UInt65 absolute timestamp in the future when the lock should expire
   */
  @method
  deposit(secret: Secret, expireAt: UInt64) {
    // verify preconditions
    this.assertNoHashlockExists();
    this.assertExpiresAtInSufficientFuture(expireAt);

    // update state
    this.setHashLock(secret);

    // TODO: verify balance / ownership of tokens for the contract
    // in order to release it later
    // this.experimental.token.send({});
  }

  assertNoRevealedSecret() {
    // assert the secret has not been revealed yet
    const currentSecret = this.secret.get();
    this.secret.assertEquals(currentSecret);
    this.secret.assertNothing();
  }

  assertSecretHashEqualsHashlock(secret: Secret) {
    // check if the secret results into an identical hash
    const currentHashlock = this.hashlock.get();
    // precondition asserting data consistency between proving and verification
    this.hashlock.assertEquals(currentHashlock);
    const expectedHashlock = Poseidon.hash(secret.value);
    // assert if the provided secret matches the secret used to create the original hashlock
    this.hashlock.assertEquals(expectedHashlock);
  }

  /**
   * Method that withdraw locked funds, if an appropriate secret was provided and the timelock has not expired yet.
   * @param secret
   */
  @method
  withdraw(secret: Secret) {
    // verify preconditions
    this.assertNoRevealedSecret();
    this.assertSecretHashEqualsHashlock(secret);

    // TODO: continue with transfer business logic here
    // release all locked funds
  }

  /**
   * Method to refund locked tokens after the timelock has expired
   */
  @method
  refund() {}

  deploy(args: DeployArgs) {
    super.deploy(args);

    // setup permissions
    this.setPermissions({
      ...Permissions.default(),
      // for testing purposes, allow tx signed with the app's private key to update state
      editState: Permissions.proofOrSignature(),
    });
  }
}
