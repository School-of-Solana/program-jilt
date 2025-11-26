import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import {
    PublicKey,
    Transaction,
    TransactionInstruction,
    SystemProgram,
} from '@solana/web3.js';
import { getTransferCheckedInstruction, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import React, { useState } from 'react';

// --- Configuration ---
const HOOK_PROGRAM_ID = new PublicKey("hoo9kSHtfFY6PLUoqEkHcZQJpTQvDYBi16GNXji8Z98");
const HOOKED_TOKEN_MINT = new PublicKey("pdGgJFH4AB4RBUwLouZSM5hREypXHDafeHc419cCz1p");
const FEE_TOKEN_MINT = new PublicKey("So11111111111111111111111111111111111111112"); // Wrapped SOL

function App() {
    const { connection } = useConnection();
    const { publicKey, sendTransaction } = useWallet();
    const [status, setStatus] = useState('');
    const [txSignature, setTxSignature] = useState('');

    // State for form inputs
    const [transferAmount, setTransferAmount] = useState('');
    const [transferRecipient, setTransferRecipient] = useState('');
    const [withdrawAmount, setWithdrawAmount] = useState('');

    const logStatus = (message: string, signature?: string) => {
        console.log(message);
        setStatus(message);
        if (signature) {
            setTxSignature(signature);
        } else {
            setTxSignature('');
        }
    };

    const handleInit = async () => {
        if (!publicKey) {
            logStatus('Error: Wallet not connected.');
            return;
        }
        logStatus('Initializing program accounts...');

        try {
            // 1. Initialize Extra Account Metas
            const [extraMetasPda] = PublicKey.findProgramAddressSync(
                [Buffer.from("extra-account-metas"), HOOKED_TOKEN_MINT.toBuffer()],
                HOOK_PROGRAM_ID
            );
            const initMetasIx = new TransactionInstruction({
                programId: HOOK_PROGRAM_ID,
                data: Buffer.from([1]), // Discriminator for initialize_extra_account_meta_list
                keys: [
                    { pubkey: publicKey, isSigner: true, isWritable: true },
                    { pubkey: extraMetasPda, isSigner: false, isWritable: true },
                    { pubkey: HOOKED_TOKEN_MINT, isSigner: false, isWritable: false },
                    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                ]
            });

            // 2. Initialize Treasury
            const [treasuryPda] = PublicKey.findProgramAddressSync(
                [Buffer.from("my-treasury"), FEE_TOKEN_MINT.toBuffer()],
                HOOK_PROGRAM_ID
            );
            const initTreasuryIx = new TransactionInstruction({
                programId: HOOK_PROGRAM_ID,
                data: Buffer.from([3]), // Discriminator for initialize_treasury
                keys: [
                    { pubkey: publicKey, isSigner: true, isWritable: true },
                    { pubkey: treasuryPda, isSigner: false, isWritable: true },
                    { pubkey: FEE_TOKEN_MINT, isSigner: false, isWritable: false },
                    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                ]
            });

            const transaction = new Transaction().add(initMetasIx).add(initTreasuryIx);
            const signature = await sendTransaction(transaction, connection);
            logStatus('Initialization transaction sent...', signature);

            await connection.confirmTransaction(signature, 'confirmed');
            logStatus('✅ Initialization successful!', signature);
        } catch (error: any) {
            logStatus(`❌ Error: ${error.message}`);
        }
    };

    const handleTransfer = async () => {
        if (!publicKey) {
            logStatus('Error: Wallet not connected.');
            return;
        }
        if (!transferRecipient || !transferAmount) {
            logStatus('Error: Please provide a recipient and amount.');
            return;
        }

        try {
            const recipient = new PublicKey(transferRecipient);
            const amount = BigInt(transferAmount);
            logStatus(`Transferring ${amount} tokens to ${recipient.toBase58()}...`);

            // NOTE: These are the same hardcoded ATAs from your CLI.
            // In a real app, you'd derive these using getAssociatedTokenAddress.
            const senderATA = new PublicKey("3hZkh7SHwhGfj59mQfzWYXoSeBCDchZUSUwVbUy9zeMo");
            const receiverATA = new PublicKey("8sHBrRHnDZxPDK1DsM2TY8B7n1PXJqa49s3oMP4e3UVc");

            const [extraMetasPda] = PublicKey.findProgramAddressSync(
                [Buffer.from("extra-account-metas"), HOOKED_TOKEN_MINT.toBuffer()],
                HOOK_PROGRAM_ID
            );

            const transferIx = getTransferCheckedInstruction(
                senderATA,
                HOOKED_TOKEN_MINT,
                receiverATA,
                publicKey, // Authority
                amount,
                9, // Decimals
                [],
                TOKEN_2022_PROGRAM_ID
            );

            // Add the extra accounts required by the hook
            transferIx.keys.push(
                { pubkey: extraMetasPda, isSigner: false, isWritable: false },
                { pubkey: HOOK_PROGRAM_ID, isSigner: false, isWritable: false }
            );

            const transaction = new Transaction().add(transferIx);
            const signature = await sendTransaction(transaction, connection);
            logStatus('Transfer transaction sent...', signature);

            await connection.confirmTransaction(signature, 'confirmed');
            logStatus('✅ Transfer successful!', signature);
        } catch (error: any) {
            logStatus(`❌ Error: ${error.message}`);
        }
    };

    const handleWithdraw = async () => {
        if (!publicKey) {
            logStatus('Error: Wallet not connected.');
            return;
        }
        if (!withdrawAmount) {
            logStatus('Error: Please provide an amount to withdraw.');
            return;
        }

        try {
            const amount = BigInt(withdrawAmount);
            logStatus(`Withdrawing ${amount} from treasury...`);

            const [treasuryPda] = PublicKey.findProgramAddressSync(
                [Buffer.from("my-treasury"), FEE_TOKEN_MINT.toBuffer()],
                HOOK_PROGRAM_ID
            );

            // NOTE: Hardcoded from your CLI. In a real app, you'd derive this.
            const adminWsolAta = new PublicKey("CptnNxRJp2adjccrLA3P1UvFVpPsZ3HRU9Uui7egGRDJ");

            // Anchor discriminator for `withdraw` + amount as u64 little-endian
            const instructionData = Buffer.concat([
                Buffer.from([133, 130, 18, 23, 110, 102, 16, 219]), // withdraw discriminator
                Buffer.from(new BigUint64Array([amount]).buffer)
            ]);

            const withdrawIx = new TransactionInstruction({
                programId: HOOK_PROGRAM_ID,
                data: instructionData,
                keys: [
                    { pubkey: publicKey, isSigner: true, isWritable: true },
                    { pubkey: FEE_TOKEN_MINT, isSigner: false, isWritable: false },
                    { pubkey: treasuryPda, isSigner: false, isWritable: true },
                    { pubkey: adminWsolAta, isSigner: false, isWritable: true },
                    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                ]
            });

            const transaction = new Transaction().add(withdrawIx);
            const signature = await sendTransaction(transaction, connection);
            logStatus('Withdraw transaction sent...', signature);

            await connection.confirmTransaction(signature, 'confirmed');
            logStatus('✅ Withdraw successful!', signature);
        } catch (error: any) {
            logStatus(`❌ Error: ${error.message}`);
        }
    };

    return (
        <div className="App">
            <header className="App-header">
                <h1>Tax Hook Interface</h1>
                <WalletMultiButton />
            </header>
            <main className="App-main">
                <div className="card">
                    <h2>Admin: Initialize Program</h2>
                    <p>Run this once to set up the required PDAs for the hook.</p>
                    <button onClick={handleInit} disabled={!publicKey}>Initialize</button>
                </div>

                <div className="card">
                    <h2>Action: Transfer Tokens</h2>
                    <p>Transfer tokens to trigger the fee hook.</p>
                    <input type="text" placeholder="Recipient Address" value={transferRecipient} onChange={e => setTransferRecipient(e.target.value)} />
                    <input type="number" placeholder="Amount (in smallest units)" value={transferAmount} onChange={e => setTransferAmount(e.target.value)} />
                    <button onClick={handleTransfer} disabled={!publicKey}>Transfer</button>
                </div>

                <div className="card">
                    <h2>Admin: Withdraw Fees</h2>
                    <p>Withdraw collected fees from the treasury.</p>
                    <input type="number" placeholder="Amount (in smallest units)" value={withdrawAmount} onChange={e => setWithdrawAmount(e.target.value)} />
                    <button onClick={handleWithdraw} disabled={!publicKey}>Withdraw</button>
                </div>

                <div className="status-card">
                    <h2>Status</h2>
                    <p>{status}</p>
                    {txSignature && (
                        <p>
                            <a href={`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`} target="_blank" rel="noopener noreferrer">
                                View on Explorer
                            </a>
                        </p>
                    )}
                </div>
            </main>
        </div>
    );
}

export default App;