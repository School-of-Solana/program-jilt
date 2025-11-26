import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
    Keypair,
    SystemProgram,
    PublicKey,
    Transaction,
    sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
    TOKEN_2022_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    getAssociatedTokenAddressSync,
    createAssociatedTokenAccountInstruction,
    createMint,
    mintTo,
    getAccount,
    getTransferCheckedInstruction,
} from "@solana/spl-token";
import { Taxhook } from "../target/types/taxhook";
import { expect } from "chai";

describe("tax-hook", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const wallet = provider.wallet as anchor.Wallet;
    const connection = provider.connection;

    const program = anchor.workspace.Taxhook as Program<Taxhook>;

    // Keypairs and addresses
    const admin = wallet.payer;
    const recipient = new Keypair();
    let hookedTokenMint: PublicKey;
    let feeTokenMint: PublicKey; // wSOL

    // PDAs
    let extraMetasPda: PublicKey;
    let treasuryPda: PublicKey;

    // ATAs
    let adminHookedTokenAta: PublicKey;
    let recipientHookedTokenAta: PublicKey;
    let adminFeeTokenAta: PublicKey;

    const FEE_BASIS_POINTS = new BN(100); // 1%
    const TRANSFER_AMOUNT = new BN(1000 * 10 ** 9); // 1000 tokens with 9 decimals

    before(async () => {
        // --- Create Mints ---
        // Create the token that will have the transfer hook
        hookedTokenMint = await createMint(
            connection,
            admin,
            admin.publicKey,
            null,
            9, // 9 decimals
            undefined,
            { commitment: "confirmed" },
            TOKEN_2022_PROGRAM_ID
        );

        // Use wSOL as the fee token
        feeTokenMint = new PublicKey("So11111111111111111111111111111111111111112");

        // --- Find PDAs ---
        [extraMetasPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("extra-account-metas"), hookedTokenMint.toBuffer()],
            program.programId
        );
        [treasuryPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("my-treasury"), feeTokenMint.toBuffer()],
            program.programId
        );

        // --- Create ATAs ---
        adminHookedTokenAta = getAssociatedTokenAddressSync(hookedTokenMint, admin.publicKey, false, TOKEN_2022_PROGRAM_ID);
        recipientHookedTokenAta = getAssociatedTokenAddressSync(hookedTokenMint, recipient.publicKey, false, TOKEN_2022_PROGRAM_ID);
        adminFeeTokenAta = getAssociatedTokenAddressSync(feeTokenMint, admin.publicKey);

        const tx = new Transaction().add(
            createAssociatedTokenAccountInstruction(admin.publicKey, adminHookedTokenAta, admin.publicKey, hookedTokenMint, TOKEN_2022_PROGRAM_ID),
            createAssociatedTokenAccountInstruction(admin.publicKey, recipientHookedTokenAta, recipient.publicKey, hookedTokenMint, TOKEN_2022_PROGRAM_ID),
            createAssociatedTokenAccountInstruction(admin.publicKey, adminFeeTokenAta, admin.publicKey, feeTokenMint, TOKEN_PROGRAM_ID)
        );
        await sendAndConfirmTransaction(connection, tx, [admin]);

        // --- Mint initial tokens to admin ---
        await mintTo(
            connection,
            admin,
            hookedTokenMint,
            adminHookedTokenAta,
            admin,
            TRANSFER_AMOUNT.toNumber() * 2, // Mint enough for the transfer
            [],
            { commitment: "confirmed" },
            TOKEN_2022_PROGRAM_ID
        );
    });

    it("Initializes the program accounts!", async () => {
        // Initialize Extra Account Metas
        await program.methods
            .initializeExtraAccountMetaList()
            .accounts({
                payer: admin.publicKey,
                extraAccountMetaList: extraMetasPda,
                mint: hookedTokenMint,
                systemProgram: SystemProgram.programId,
            })
            .rpc({ commitment: "confirmed" });

        // Initialize Treasury
        await program.methods
            .initializeTreasury()
            .accounts({
                payer: admin.publicKey,
                treasury: treasuryPda,
                feeMint: feeTokenMint,
                systemProgram: SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc({ commitment: "confirmed" });

        // Verify treasury account was created and is owned by the token program
        const treasuryAccount = await getAccount(connection, treasuryPda, "confirmed", TOKEN_PROGRAM_ID);
        expect(treasuryAccount.owner.equals(admin.publicKey)).to.be.false;
        expect(treasuryAccount.mint.equals(feeTokenMint)).to.be.true;
    });

    it("Executes a transfer and correctly applies the fee", async () => {
        const initialAdminBalance = (await getAccount(connection, adminHookedTokenAta, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
        const initialRecipientBalance = (await getAccount(connection, recipientHookedTokenAta, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
        const initialTreasuryBalance = (await getAccount(connection, treasuryPda, "confirmed", TOKEN_PROGRAM_ID)).amount;

        const feeAmount = (TRANSFER_AMOUNT.mul(FEE_BASIS_POINTS)).div(new BN(10000));

        // Create the transfer instruction with the extra accounts for the hook
        const transferIx = getTransferCheckedInstruction(
            adminHookedTokenAta,
            hookedTokenMint,
            recipientHookedTokenAta,
            admin.publicKey,
            TRANSFER_AMOUNT.toBigInt(),
            9,
            [],
            TOKEN_2022_PROGRAM_ID
        );
        transferIx.keys.push(
            { pubkey: extraMetasPda, isSigner: false, isWritable: false },
            { pubkey: program.programId, isSigner: false, isWritable: false }
        );

        const tx = new Transaction().add(transferIx);
        await sendAndConfirmTransaction(connection, tx, [admin], { commitment: "confirmed" });

        // --- Assertions ---
        const finalAdminBalance = (await getAccount(connection, adminHookedTokenAta, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
        const finalRecipientBalance = (await getAccount(connection, recipientHookedTokenAta, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
        const finalTreasuryBalance = (await getAccount(connection, treasuryPda, "confirmed", TOKEN_PROGRAM_ID)).amount;

        // 1. Admin's balance should decrease by amount + fee
        const expectedAdminBalance = BigInt(TRANSFER_AMOUNT.add(feeAmount).toString());
        expect(initialAdminBalance - finalAdminBalance).to.equal(expectedAdminBalance);

        // 2. Recipient's balance should increase by the transfer amount
        const expectedRecipientBalance = BigInt(TRANSFER_AMOUNT.toString());
        expect(finalRecipientBalance - initialRecipientBalance).to.equal(expectedRecipientBalance);

        // 3. Treasury's balance should increase by the fee amount
        const expectedTreasuryBalance = BigInt(feeAmount.toString());
        expect(finalTreasuryBalance - initialTreasuryBalance).to.equal(expectedTreasuryBalance);

        console.log(`Fee collected: ${feeAmount.toString()} lamports`);
    });

    it("Allows the authority to withdraw from the treasury", async () => {
        const initialTreasuryBalance = (await getAccount(connection, treasuryPda, "confirmed", TOKEN_PROGRAM_ID)).amount;
        const initialAdminFeeBalance = (await getAccount(connection, adminFeeTokenAta, "confirmed", TOKEN_PROGRAM_ID)).amount;

        // We know from the previous test that the treasury has at least one fee in it.
        const withdrawAmount = new BN(initialTreasuryBalance.toString());
        expect(withdrawAmount.gtn(0)).to.be.true; // Ensure there's something to withdraw

        await program.methods
            .withdraw(withdrawAmount)
            .accounts({
                authority: admin.publicKey,
                feeMint: feeTokenMint,
                treasury: treasuryPda,
                destination: adminFeeTokenAta,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc({ commitment: "confirmed" });

        // --- Assertions ---
        const finalTreasuryBalance = (await getAccount(connection, treasuryPda, "confirmed", TOKEN_PROGRAM_ID)).amount;
        const finalAdminFeeBalance = (await getAccount(connection, adminFeeTokenAta, "confirmed", TOKEN_PROGRAM_ID)).amount;

        // 1. Treasury balance should be 0
        expect(finalTreasuryBalance).to.equal(BigInt(0));

        // 2. Admin's fee ATA should have increased by the withdrawn amount
        const expectedAdminFeeBalance = BigInt(withdrawAmount.toString());
        expect(finalAdminFeeBalance - initialAdminFeeBalance).to.equal(expectedAdminFeeBalance);

        console.log(`Withdrew ${withdrawAmount.toString()} from treasury.`);
    });

    it("Fails to withdraw from the treasury for a non-authority", async () => {
        const randomUser = new Keypair();

        // We know the treasury has some funds from the first transfer test.
        // Let's re-run a transfer to ensure it's not empty.
        const transferIx = getTransferCheckedInstruction(
            adminHookedTokenAta, hookedTokenMint, recipientHookedTokenAta, admin.publicKey,
            TRANSFER_AMOUNT.toBigInt(), 9, [], TOKEN_2022_PROGRAM_ID
        );
        transferIx.keys.push(
            { pubkey: extraMetasPda, isSigner: false, isWritable: false },
            { pubkey: program.programId, isSigner: false, isWritable: false }
        );
        await sendAndConfirmTransaction(connection, new Transaction().add(transferIx), [admin]);

        const treasuryBalance = (await getAccount(connection, treasuryPda, "confirmed", TOKEN_PROGRAM_ID)).amount;
        expect(treasuryBalance).to.be.gt(BigInt(0));

        try {
            await program.methods
                .withdraw(new BN(treasuryBalance.toString()))
                .accounts({
                    // The authority is the admin, but we sign with a random user
                    authority: admin.publicKey,
                    feeMint: feeTokenMint,
                    treasury: treasuryPda,
                    destination: adminFeeTokenAta,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([randomUser]) // Signing with the wrong keypair
                .rpc();
            // If the RPC call succeeds, the test should fail.
            expect.fail("Transaction should have failed but succeeded.");
        } catch (error) {
            // We expect an error. Check if it's a signature verification failure.
            expect(error.message).to.include("Signature verification failed");
            console.log("✅ Correctly failed withdrawal attempt by non-authority.");
        }
    });

    it("Fails a transfer if the sender cannot cover the fee", async () => {
        // Create the transfer instruction, but this time without the extra accounts
        const transferIx = getTransferCheckedInstruction(
            adminHookedTokenAta,
            hookedTokenMint,
            recipientHookedTokenAta,
            admin.publicKey,
            TRANSFER_AMOUNT.toBigInt(),
            9,
            [], // No signers
            TOKEN_2022_PROGRAM_ID // IMPORTANT: Still use Token-2022 program
        );

        // NOTE: We DO NOT add the extra accounts for the hook here.

        const tx = new Transaction().add(transferIx);
        try {
            await sendAndConfirmTransaction(connection, tx, [admin], { commitment: "confirmed" });
            expect.fail("Transfer should have failed due to missing hook accounts but succeeded.");
        } catch (error) {
            // The Token-2022 program should reject this with an "IncorrectAccount" error (0x40)
            // because the mint has a transfer hook configured, but the required accounts were not provided.
            expect(error.message).to.include("0x40");
            console.log("✅ Correctly failed transfer due to missing required hook accounts.");
        }
    });
});