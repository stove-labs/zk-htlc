import {
  AccountUpdate,
  arrayProp,
  CircuitValue,
  DeployArgs,
  Field,
  method,
  Permissions,
  Poseidon,
  PublicKey,
  SmartContract,
  state,
  State,
  UInt64,
} from 'snarkyjs';
import { assertNotZero, subDays } from './UInt64Helpers';

/**
 * Single Field secret can fit 4x UInt64, since it can store 256bits
 * TODO: wrap secret verification and reveal in a separate contract/proof
 * in order to workaround the contract storage limits
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

export type ExternalCallback = () => AccountUpdate;
export type OptionalExternalCallback = void | ExternalCallback;

export interface HTLCPoseidonConcrete {
  // eslint-disable-next-line
  depositIntoSelf(from: PublicKey, amount: UInt64): OptionalExternalCallback;
  // eslint-disable-next-line
  withdrawFromSelfTo(address: PublicKey): OptionalExternalCallback;

  // TODO: add top level non-method functions that wrap callback approvals for experimental token implementations.
  // e.g. non-@method lock() calling @method _lock() or something similar, adding a callback approval where necessary.
}

/**
 * Hash time lock contract using the Poseidon hashing function
 */
export abstract class HTLCPoseidon
  extends SmartContract
  implements HTLCPoseidonConcrete
{
  // 2 fields
  @state(PublicKey)
  refundTo: State<PublicKey> = State<PublicKey>();

  // 2 fields
  @state(PublicKey)
  recipient: State<PublicKey> = State<PublicKey>();
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
   * // TODO: replace with 'releasing' the secret via events, to free up contract on-chain storage
   *
   * IMPORTANT: This only happens at release time, never at lock time.
   */
  @state(Secret)
  secret: State<Secret> = State<Secret>();

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

  assertIsNew() {
    const recipient = this.recipient.get();
    this.recipient.assertEquals(recipient);
    // there is no recipient yet
    recipient.isEmpty().assertTrue();
  }

  assertIsNotNew() {
    const recipient = this.recipient.get();
    this.recipient.assertEquals(recipient);
    // there is no recipient yet
    recipient.isEmpty().assertFalse();
  }

  assertIsExpired() {
    const timestamp = this.network.timestamp.get();
    this.network.timestamp.assertEquals(timestamp);
    const expireAt = this.expireAt.get();
    this.expireAt.assertEquals(expireAt);

    // TODO: should we use assertLt instead?
    expireAt.assertLte(timestamp);
  }

  getRecipient() {
    const recipient = this.recipient.get();
    this.recipient.assertEquals(recipient);
    return recipient;
  }

  getRefundTo() {
    const refundTo = this.refundTo.get();
    this.refundTo.assertEquals(refundTo);
    return refundTo;
  }

  setHashLock(hashlock: Field) {
    this.hashlock.set(hashlock);
  }

  setRecipient(recipient: PublicKey) {
    this.recipient.set(recipient);
  }

  setRefundTo(refundTo: PublicKey) {
    this.refundTo.set(refundTo);
  }

  setSecret(secret: Secret) {
    this.secret.set(secret);
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

  abstract depositIntoSelf(
  // eslint-disable-next-line
    from: PublicKey,
    // eslint-disable-next-line
    amount: UInt64
  ): OptionalExternalCallback;

  @method
  lock(
    refundTo: PublicKey,
    recipient: PublicKey,
    amount: UInt64,
    hashlock: Field,
    expireAt: UInt64
  ): void {
    // console.log('tokenId');
    // Circuit.log(this.tokenId);
    // verify preconditions
    this.assertIsNew();
    this.assertExpiresAtSufficientFuture(expireAt);
    this.assertDepositAmountNotZero(amount);
    // update state
    this.setRefundTo(refundTo);
    this.setRecipient(recipient);
    this.setHashLock(hashlock);
    // transfer from someone to the contract
    this.depositIntoSelf(refundTo, amount);
  }

  // eslint-disable-next-line
  abstract withdrawFromSelfTo(address: PublicKey): OptionalExternalCallback;

  @method
  unlock(secret: Secret): void {
    // verify preconditions
    // TODO: actually check the state, not just the nonce
    this.assertIsNotNew();
    this.assertSecretHashEqualsHashlock(secret);

    this.setSecret(secret);

    const recipient = this.getRecipient();
    // TODO: implement a check for signature of the recipient, disallowing call of 'unlock' without 'being' the recipient
    const accountUpdateRecipient = AccountUpdate.create(
      recipient,
      this.tokenId
    );

    accountUpdateRecipient.requireSignature();

    // transfer from the contract to the recipient
    this.withdrawFromSelfTo(recipient);
  }

  @method
  refund() {
    this.assertIsExpired();

    const refundTo = this.getRefundTo();
    this.withdrawFromSelfTo(refundTo);
  }

  deploy(args: DeployArgs) {
    super.deploy(args);

    // setup permissions
    this.setPermissions({
      ...Permissions.default(),
      // TODO: allow only proofs in production
      // for testing purposes, allow tx signed with the app's private key to update state
      editState: Permissions.proofOrSignature(),
      send: Permissions.proof(),
    });
  }
}
