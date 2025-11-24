import { BrowserProvider, getAddress } from "ethers";

let fheInstance: any = null;

export const initializeFheInstance = async () => {
    if (fheInstance) return fheInstance;

    if (typeof window === 'undefined' || !window.ethereum) {
        throw new Error('Ethereum provider not found');
    }

    // @ts-ignore
    const sdk = window.RelayerSDK || window.relayerSDK;
    if (!sdk) {
        throw new Error('RelayerSDK not loaded');
    }

    const { initSDK, createInstance, SepoliaConfig } = sdk;

    await initSDK();

    const config = { ...SepoliaConfig, network: window.ethereum };

    try {
        fheInstance = await createInstance(config);
        return fheInstance;
    } catch (err) {
        console.error('FHEVM initialization failed:', err);
        throw err;
    }
};

export const getFheInstance = () => fheInstance;

export const createEncryptedInput = async (contractAddress: string, userAddress: string, value: number) => {
    const instance = await initializeFheInstance();
    const inputHandle = instance.createEncryptedInput(contractAddress, userAddress);
    inputHandle.add32(value);
    return await inputHandle.encrypt();
};

export const reencrypt = async (handle: bigint, contractAddress: string, userAddress: string) => {
    const instance = await initializeFheInstance();

    // Ensure addresses are checksummed
    const checksummedContractAddress = getAddress(contractAddress);
    const checksummedUserAddress = getAddress(userAddress);

    // Generate a temporary keypair for re-encryption
    const keypair = instance.generateKeypair();
    const handleStr = handle.toString();

    const handleContractPairs = [
        {
            handle: handleStr,
            contractAddress: checksummedContractAddress,
        },
    ];

    const startTimeStamp = Math.floor(Date.now() / 1000).toString();
    const durationDays = "10";
    const contractAddresses = [checksummedContractAddress];

    // Create EIP-712 signature for authorization
    const eip712 = instance.createEIP712(
        keypair.publicKey,
        contractAddresses,
        startTimeStamp,
        durationDays
    );

    // Request user signature via Metamask
    const provider = new BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const signature = await signer.signTypedData(
        eip712.domain,
        { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
        eip712.message
    );

    // Perform re-encryption using userDecrypt
    const result = await instance.userDecrypt(
        handleContractPairs,
        keypair.privateKey,
        keypair.publicKey,
        signature.replace("0x", ""),
        contractAddresses,
        checksummedUserAddress,
        startTimeStamp,
        durationDays
    );

    return result[handleStr];
};
