# ZK HTLC | Zero Knowledge Hash Time Locked Contract

![](https://img.shields.io/github/workflow/status/stove-labs/zk-htlc/CI)

> ⚠️ This repository is a work in progress, it has not been audited or tested thoroughly. Use at your own risk.

ZK HTLC is an experimental implementation of the HTLC protocol built with SnarkyJS. Allowing users to trustlessly and atomicaly swap assets/tokens.
It supports both the native MINA token, and (previously experimental) protocol built-in custom tokens. More about HTLC can be found [here](https://en.bitcoin.it/wiki/Hash_Time_Locked_Contracts).

## 🎲 Features

- Supports native MINA token
- Supports custom protocol built-in tokens
- Currently only supports Poseidon as the hashing function

## 🛫 HTLC Roundtrip

> 💡 Both `HTLCPoseidonNative` and `HTLCPoseidonExperimentalToken` can be used interchangably, depending on the tokens/assets being exchanged.

**🔒 Initial setup**

1. Alice wants to atomically swap 10 MINA for 10 TOKEN with Bob
2. Alice deploys an instance of `HTLCPoseidonNative`
3. Alice calls `HTLCPoseidonNative.lock(...)`, specifying Bob as the recipient and providing 10 MINA to the contract as the amount being locked. At this point Alice also chooses/generates a secret, and provides a hash of the secret (`hashlock`) to the contract.
4. Bob deploys an instance of `HTLCPoseidonExperimentalToken`, with the respective `tokenId` representing the token being handled in this case.
5. Bob calls `HTLCPoseidonExperimentalToken.lock()`, specifying Alice as the recipient and providing 10 TOKEN to the contract as the amount being locked. Bob also provides the same hashlock as Alice did to hers instance.

**🔓 Unlocking locked assets/tokens**

1. Alice calls Bob's `HTLCPoseidonExperimentalToken.unlock()`, providing the secret used to generate the hashlock used to deploy both of their contracts. This reveals the secret to Bob and transfers the funds from the contract to Alice.
2. Bob calls Alice's `HTLCPoseidonNative.unlock()`, using the secret he obtained from Alice. This transfers the funds from the contract to Bob
3. Done!

**📆 Edge cases**

For a case when one of the participants fails to unlock the locked tokens, the creator of the contract can refund the locked tokens using the `.refund()` method.

## Credits

<img  src="https://stove-labs.com/logo_transparent.png" width="150px"/>

Special thanks to [Gregor](https://github.com/mitschabaude), [Jack](https://github.com/jackryanservia) and [O1 Labs](https://github.com/o1-labs) for their work on SnarkyJS.

## License

[Apache-2.0](LICENSE)
