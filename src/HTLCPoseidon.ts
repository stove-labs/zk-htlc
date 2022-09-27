import {
  arrayProp,
  CircuitValue,
  DeployArgs,
  Field,
  Group,
  method,
  Permissions,
  Poseidon,
  prop,
  PublicKey,
  SmartContract,
  state,
  State,
  UInt32,
  UInt64,
} from 'snarkyjs';
import { assertNotZero, subDays } from './UInt64Helpers';

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

export class Recipient extends CircuitValue {
  @prop value: Group;

  static fromPublicKey(publicKey: PublicKey): Recipient {
    const recipient = new Recipient();
    // this will always be two fields;
    recipient.value = publicKey.toGroup();
    return recipient;
  }

  toPublicKey(): PublicKey {
    return PublicKey.fromGroup(this.value);
  }
}

export interface HTLCPoseidonConcrete {
  // eslint-disable-next-line
  depositIntoSelf(amount: UInt64): void;
  // eslint-disable-next-line
  withdrawFromSelfToRecipient(recipient: Recipient): void;
}

/**
 * Hash time lock contract using the Poseidon hashing function
 */
export abstract class HTLCPoseidon
  extends SmartContract
  implements HTLCPoseidonConcrete
{
  // 2 fields
  @state(Recipient)
  recipient: State<Recipient> = State<Recipient>();
  // 1 field
  @state(Field)
  hashlock: State<Field> = State<Field>();
  // 1 field
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

  assertIsFirstTransaction() {
    const nonce = this.account.nonce.get();
    this.account.nonce.assertEquals(nonce);
    // check if this is the first transaction that happened to the contract
    nonce.assertEquals(UInt32.fromNumber(1));
  }

  assertIsSecondTransaction() {
    const nonce = this.account.nonce.get();
    this.account.nonce.assertEquals(nonce);
    // check if this is the second transaction that happened to the contract
    nonce.assertEquals(UInt32.fromNumber(2));
  }

  assertExpiresAtSufficientFuture(expireAt: UInt64) {
    const timestamp = this.network.timestamp.get();
    this.network.timestamp.assertEquals(timestamp);
    // assert that expiresAt is at least 3 days in the future
    // TODO: should we use absolute value for expireAt, or relative to timestamp?
    // e.g. expireAt = timestamp+expireAt

    const expireSubThreeDays = subDays(expireAt, 3);
    expireSubThreeDays.assertGt(timestamp);
  }

  assertDepositAmountNotZero(amount: UInt64) {
    assertNotZero(amount);
  }

  setHashLock(hashlock: Field) {
    this.hashlock.set(hashlock);
  }

  setRecipient(recipient: Recipient) {
    this.recipient.set(recipient);
  }

  assertSecretHashEqualsHashlock(secret: Secret) {
    // check if the secret results into an identical hash
    const currentHashlock = this.hashlock.get();
    // precondition asserting data consistency between proving and verification
    this.hashlock.assertEquals(currentHashlock);
    const expectedHashlock = Poseidon.hash(secret.value);
    // assert if the provided secret matches the secret used to create the original hashlock
    currentHashlock.assertEquals(expectedHashlock);
  }

  // eslint-disable-next-line
  abstract depositIntoSelf(amount: UInt64): void;

  @method
  lock(
    recipient: Recipient,
    amount: UInt64,
    hashlock: Field,
    expireAt: UInt64
  ) {
    // verify preconditions
    this.assertIsFirstTransaction();
    this.assertExpiresAtSufficientFuture(expireAt);
    this.assertDepositAmountNotZero(amount);

    // update state
    this.setRecipient(recipient);
    this.setHashLock(hashlock);

    // transfer from someone to the contract
    this.depositIntoSelf(amount);
  }

  // eslint-disable-next-line
  abstract withdrawFromSelfToRecipient(recipient: Recipient): void;

  getRecipient() {
    const recipient = this.recipient.get();
    this.recipient.assertEquals(recipient);
    return recipient;
  }

  @method
  unlock(secret: Secret) {
    // verify preconditions
    this.assertIsSecondTransaction();
    this.assertSecretHashEqualsHashlock(secret);

    const recipient = this.getRecipient();
    // transfer from the contract to the recipient
    this.withdrawFromSelfToRecipient(recipient);
  }

  @method
  refund() {}

  deploy(args: DeployArgs) {
    super.deploy(args);

    // setup permissions
    this.setPermissions({
      ...Permissions.default(),
      // TODO: allow only proofs in production
      // for testing purposes, allow tx signed with the app's private key to update state
      editState: Permissions.proofOrSignature(),
    });
  }
}
