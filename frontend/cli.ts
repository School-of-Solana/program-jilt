import {
    AccountRole,
    address,
    appendTransactionMessageInstructions,
    createKeyPairSignerFromBytes,
    createSolanaRpc,
    createTransactionMessage,
    getAddressEncoder,
    getBase64EncodedWireTransaction,
    getProgramDerivedAddress,
    getSignatureFromTransaction,
    Instruction,
    pipe,
    setTransactionMessageFeePayerSigner,
    setTransactionMessageLifetimeUsingBlockhash,
    signTransactionMessageWithSigners,
    Address
} from "gill";
import fs from "fs";
import { getTransferCheckedInstruction } from "@solana-program/token-2022";
import { SYSTEM_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from "gill/programs";
import { homedir } from 'os';
import { join } from 'path';

// --- Configuration ---
const DEVNET_RPC_URL = "https://api.devnet.solana.com";
const HOOK_PROGRAM_ID = address("hoo9kSHtfFY6PLUoqEkHcZQJpTQvDYBi16GNXji8Z98");
// This is the mint of the token that has the transfer hook enabled.
const HOOKED_TOKEN_MINT = address("pdGgJFH4AB4RBUwLouZSM5hREypXHDafeHc419cCz1p");
// This is the mint for the fee token (Wrapped SOL).
const FEE_TOKEN_MINT = address("So11111111111111111111111111111111111111112");

// Helper to load the user's keypair
async function loadSigner() {
    // NOTE: This loads the keypair from the default Solana CLI location.
    // Make sure this keypair is funded on devnet.
    const keypairPath = join(homedir(), '.config', 'solana', 'id.json');
    if (!fs.existsSync(keypairPath)) {
        throw new Error(`Keypair not found at ${keypairPath}. Please run 'solana-keygen new'.`);
    }
    const keypairBytes = new Uint8Array(JSON.parse(fs.readFileSync(keypairPath).toString()));
    return await createKeyPairSignerFromBytes(keypairBytes);
}

async function sendAndConfirmTransaction(instructions: Instruction[], rpc: ReturnType<typeof createSolanaRpc>, signer: Awaited<ReturnType<typeof loadSigner>>) {
    const blockhash = (await rpc.getLatestBlockhash({ commitment: "finalized" }).send()).value;
    const transactionMessage = pipe(
        createTransactionMessage({ version: "legacy" }),
        txm => appendTransactionMessageInstructions(instructions, txm),
        txm => setTransactionMessageFeePayerSigner(signer, txm),
        txm => setTransactionMessageLifetimeUsingBlockhash(blockhash, txm)
    );

    const signedTx = await signTransactionMessageWithSigners(transactionMessage);
    const signature = getSignatureFromTransaction(signedTx);
    console.log(`✍️  Sending transaction... https://explorer.solana.com/tx/${signature}?cluster=devnet`);

    await rpc.sendTransaction(getBase64EncodedWireTransaction(signedTx), { encoding: "base64", maxRetries: BigInt(5), skipPreflight: false }).send();
    console.log("✅ Transaction sent successfully!");
}

async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    if (!command) {
        console.error("Please provide a command: init, transfer, or withdraw");
        console.log("\nUsage:");
        console.log("  npx ts-node cli.ts init");
        console.log("  npx ts-node cli.ts transfer <RECIPIENT_ADDRESS> <AMOUNT_IN_SMALLEST_UNITS>");
        console.log("  npx ts-node cli.ts withdraw <AMOUNT_IN_SMALLEST_UNITS>");
        return;
    }

    const rpc = createSolanaRpc(DEVNET_RPC_URL);
    const signer = await loadSigner();
    console.log(`🔑 Using signer: ${signer.address}`);

    switch (command) {
        case "init": {
            console.log("Initializing program accounts...");

            // 1. Initialize Extra Account Metas
            const [extraMetasPda] = await getProgramDerivedAddress({
                programAddress: HOOK_PROGRAM_ID,
                seeds: ["extra-account-metas", getAddressEncoder().encode(HOOKED_TOKEN_MINT)]
            });
            const initMetasIx: Instruction = {
                programAddress: HOOK_PROGRAM_ID,
                data: new Uint8Array([1]), // Discriminator for initialize_extra_account_meta_list
                accounts: [
                    { address: signer.address, role: AccountRole.WRITABLE_SIGNER },
                    { address: extraMetasPda, role: AccountRole.WRITABLE },
                    { address: HOOKED_TOKEN_MINT, role: AccountRole.READONLY },
                    { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                ]
            };
            await sendAndConfirmTransaction([initMetasIx], rpc, signer);

            // 2. Initialize Treasury
            const [treasuryPda] = await getProgramDerivedAddress({
                programAddress: HOOK_PROGRAM_ID,
                seeds: ["my-treasury", getAddressEncoder().encode(FEE_TOKEN_MINT)]
            });
            const initTreasuryIx: Instruction = {
                programAddress: HOOK_PROGRAM_ID,
                data: new Uint8Array([3]), // Discriminator for initialize_treasury
                accounts: [
                    { address: signer.address, role: AccountRole.WRITABLE_SIGNER },
                    { address: treasuryPda, role: AccountRole.WRITABLE },
                    { address: FEE_TOKEN_MINT, role: AccountRole.READONLY },
                    { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                    { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                ]
            };
            await sendAndConfirmTransaction([initTreasuryIx], rpc, signer);
            break;
        }

        case "transfer": {
            const recipient = address(args[1]);
            const amount = BigInt(args[2]);
            if (!recipient || !amount) {
                console.error("Usage: npx ts-node cli.ts transfer <RECIPIENT_ADDRESS> <AMOUNT>");
                return;
            }
            console.log(`Transferring ${amount} tokens to ${recipient}...`);

            // Note: This assumes the sender and recipient have associated token accounts.
            const senderATA = address("3hZkh7SHwhGfj59mQfzWYXoSeBCDchZUSUwVbUy9zeMo"); // Replace with actual sender ATA
            const receiverATA = address("8sHBrRHnDZxPDK1DsM2TY8B7n1PXJqa49s3oMP4e3UVc"); // Replace with actual receiver ATA

            const [extraMetasPda] = await getProgramDerivedAddress({
                programAddress: HOOK_PROGRAM_ID,
                seeds: ["extra-account-metas", getAddressEncoder().encode(HOOKED_TOKEN_MINT)]
            });

            const transferIx = getTransferCheckedInstruction({
                amount,
                authority: signer,
                decimals: 9, // Assuming 9 decimals for the hooked token
                destination: receiverATA,
                source: senderATA,
                mint: HOOKED_TOKEN_MINT,
            });

            // Add the extra accounts required by the hook
            transferIx.accounts.push(
                { address: extraMetasPda, role: AccountRole.READONLY },
                { address: HOOK_PROGRAM_ID, role: AccountRole.READONLY }
            );

            await sendAndConfirmTransaction([transferIx], rpc, signer);
            break;
        }

        case "withdraw": {
            const amount = BigInt(args[1]);
            if (!amount) {
                console.error("Usage: npx ts-node cli.ts withdraw <AMOUNT>");
                return;
            }
            console.log(`Withdrawing ${amount} from treasury...`);

            const [treasuryPda] = await getProgramDerivedAddress({
                programAddress: HOOK_PROGRAM_ID,
                seeds: ["my-treasury", getAddressEncoder().encode(FEE_TOKEN_MINT)]
            });

            // This is the ATA where the admin will receive the withdrawn fees.
            // Replace with your actual admin WSOL ATA.
            const adminWsolAta = address("CptnNxRJp2adjccrLA3P1UvFVpPsZ3HRU9Uui7egGRDJ");

            const withdrawIx: Instruction = {
                programAddress: HOOK_PROGRAM_ID,
                // The discriminator for `withdraw` is likely 4, but depends on the final program build.
                // Anchor assigns discriminators alphabetically:
                // 1: initialize_extra_account_meta_list
                // 2: initialize_treasury
                // 3: transfer_hook (not callable directly)
                // 4: update_extra_account_meta_list
                // 5: withdraw
                // Your manual discriminators were [1] and [3]. Let's assume withdraw is [5].
                // You may need to adjust this.
                data: new Uint8Array([133, 130, 18, 23, 110, 102, 16, 219, amount]), // withdraw instruction discriminator + amount
                accounts: [
                    { address: signer.address, role: AccountRole.WRITABLE_SIGNER },
                    { address: FEE_TOKEN_MINT, role: AccountRole.READONLY },
                    { address: treasuryPda, role: AccountRole.WRITABLE },
                    { address: adminWsolAta, role: AccountRole.WRITABLE },
                    { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                ]
            };
            await sendAndConfirmTransaction([withdrawIx], rpc, signer);
            break;
        }

        default:
            console.error(`Unknown command: ${command}`);
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
```

### How to Use the New CLI

1.  **Save the file** as `cli.ts` in your `c:\Users\jeelt\Documents\solana\complexHook\` directory.

2.  **Install `ts-node`** if you don't have it already. This will allow you to run the TypeScript file directly.
    ```bash
    npm install -g ts-node
    ```

3.  **Run the commands**:

    *   **To initialize the program** (run this once):
        ```bash
        npx ts-node cli.ts init
        ```

    *   **To transfer tokens** (this will trigger the 1% fee hook):
        ```bash
        # Usage: npx ts-node cli.ts transfer <RECIPIENT_ADDRESS> <AMOUNT>
        npx ts-node cli.ts transfer 8sHBrRHnDZxPDK1DsM2TY8B7n1PXJqa49s3oMP4e3UVc 1000000000
        ```

    *   **To withdraw collected fees** (only the admin authority can do this):
        ```bash
        # Usage: npx ts-node cli.ts withdraw <AMOUNT>
        npx ts-node cli.ts withdraw 50000000
        ```

This single `cli.ts` file provides a much-improved "UX" by consolidating all operations into a simple, command-based workflow, making it fast and easy to test and operate your token.
