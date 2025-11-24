import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { initializeFheInstance, getFheInstance } from '../utils/fhevm';
import { BrowserProvider } from 'ethers';

interface FhevmContextType {
    isInitialized: boolean;
    error: string | null;
    connect: () => Promise<void>;
    account: string | null;
}

const FhevmContext = createContext<FhevmContextType>({
    isInitialized: false,
    error: null,
    connect: async () => { },
    account: null,
});

export const useFhevm = () => useContext(FhevmContext);

export const FhevmProvider = ({ children }: { children: ReactNode }) => {
    const [isInitialized, setIsInitialized] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [account, setAccount] = useState<string | null>(null);

    const connect = async () => {
        if (!window.ethereum) {
            setError("Metamask not installed");
            return;
        }

        try {
            const provider = new BrowserProvider(window.ethereum);
            const accounts = await provider.send("eth_requestAccounts", []);
            setAccount(accounts[0]);

            await initializeFheInstance();
            setIsInitialized(true);
            setError(null);
        } catch (err: any) {
            console.error("FHEVM init error:", err);
            setError(err.message || "Failed to initialize FHEVM");
            setIsInitialized(false);
        }
    };

    useEffect(() => {
        // Auto connect if already authorized
        if (window.ethereum) {
            window.ethereum.request({ method: 'eth_accounts' }).then((accounts: string[]) => {
                if (accounts.length > 0) {
                    connect();
                }
            });
        }
    }, []);

    return (
        <FhevmContext.Provider value={{ isInitialized, error, connect, account }}>
            {children}
        </FhevmContext.Provider>
    );
};
