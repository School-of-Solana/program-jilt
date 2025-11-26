# Project Description

**Deployed Frontend URL:** LINK

**Solana Program ID:** ID

## Project Overview

### Description
This program implements a transfer hook for the SPL Token-2022 standard. A transfer hook is a powerful feature that allows a program to execute custom logic every time a specific token is transferred.

In simple terms, this program is designed to take a 1% fee on every transfer of a Token-2022 token that has this hook enabled.

### Key Features
**Transfer_hook function**: This is the core logic of the program. It's not called directly by users but is automatically invoked by the Token-2022 program during a transfer. It calculates a fee equal to 1% of the amount being transferred.
It then transfers this fee amount in Wrapped SOL (WSOL) from the sender's WSOL account to a special treasury account (treasury_pda) controlled by the program.
This fee transfer is authorized by a Program Derived Address (PDA), delegate_pda, which means the user must have pre-approved this PDA to spend their WSOL.
**Initialize_treasury function**: This is a setup function to create the PDA (treasury_pda) that will collect the fees. It creates it as a token account for a specific mint. Based on the hook's logic, this would be used to create the treasury for WSOL.
**Initialize_extra_account_meta_list & update_extra_account_meta_list functions**: The Token-2022 transfer hook standard requires that all extra accounts needed by the hook logic must be pre-registered in a special on-chain account (ExtraAccountMetaList).

These functions create and manage this list. The list tells the Solana runtime which additional accounts (like the treasury, the sender's WSOL account, etc.) to load and provide to your transfer_hook function when it's called.

### How to Use the CLI UI
**Configuration**: It defines crucial addresses for its operation:
HOOK_PROGRAM_ID: The on-chain address of your custom transfer hook program.
HOOKED_TOKEN_MINT: The mint address of the token that has the transfer hook enabled.
FEE_TOKEN_MINT: The mint address for the token used to pay fees (in this case, Wrapped SOL).
Signer Loading: The loadSigner function automatically loads the default Solana CLI keypair from your computer. This keypair is used to sign and pay for the transactions.
Transaction Handling: The sendAndConfirmTransaction function simplifies the process of building, signing, and sending a transaction to the Solana network.
Supported Commands

1. **init** - To perform a one-time setup for the hook program.
   It initializes an extra-account-metas Program-Derived Address (PDA). This is a standard requirement for the Token-2022 transfer hook, telling the runtime which    additional accounts the hook program needs during a transfer.
   It initializes a treasury PDA, which is a custom account used by the hook program to collect and store the fees taken from transfers.
   Usage: npx ts-node cli.ts init
2. **transfer** - To execute a token transfer that will trigger the custom hook logic.
   It takes a recipient address and an amount as input.
   It creates a standard token transfer instruction.
   Crucially, it adds the required extra accounts for the hook, which signals the Solana runtime to invoke your custom program's logic (e.g., to deduct a fee) as     part of the transfer.
   Usage: npx ts-node cli.ts transfer <RECIPIENT_ADDRESS> <AMOUNT>
3. **withdraw** - Allows the program's authority (the administrator) to withdraw the collected fees from the treasury account.
    It takes an amount as input.
    It constructs an instruction to call the withdraw function in the smart contract, which moves funds from the treasury PDA to an admin-controlled token account.
    Usage: npx ts-node cli.ts withdraw <AMOUNT>

## Program Architecture
I created a tax mechanism for a custom token. When someone transfers Token A, my program automatically takes a 1% fee in WSOL from their wallet.

### PDA Usage
**Derivation**: The Solana runtime takes the seeds ("treasury" and the mint's public key) and the program's ID and uses them to generate a unique public key. This is the address of your treasury_pda.

**Initialization**: The initialize_treasury function is responsible for actually creating the account on-chain, it:

- Calculates the PDA using the seeds mentioned above.
- Creates a new token account at that derived address.
- Sets the owner of this new token account to be the PDA itself, ensuring only the program can control it.
  
Usage: Later, when the transfer_hook is executed, it uses the exact same seeds ("treasury" and the mint's public key) to find the treasury account that was created earlier. This allows it to transfer the 1% fee into the correct account.

**PDAs Used:**
The **treasury_pda** is created using the following two seeds `["treasur", public key of the mint account for which the treasury is being created]`

### Program Instructions
**Instructions Implemented:**
- **transfer_hook**: To take a 1% fee in Wrapped SOL (WSOL) on every token transfer.
- **initialize_extra_account_meta_list**: Setup instruction that must be called once for each token mint that will use the transfer hook to create and initialize an on-chain account (extra_account_meta_list) that stores the list of all additional accounts required by the transfer_hook instruction. The Token-2022 program reads this list to know which accounts to pass into your hook.
- **update_extra_account_meta_list**: To update the on-chain list of accounts required by the transfer_hook. This is useful if the hook's logic changes and requires different or additional accounts
- **initialize_treasury**: One-time setup instruction used to create the account that will collect the fees, to create the program-controlled token account (treasury_pda) that will receive and store the transfer fees.
- **withdraw**: It first checks if the transaction signer's key matches the ADMIN_AUTHORITY. If not, it returns an Unauthorized error.
It then performs a CPI to the token program to transfer the specified amount from the treasury_pda to a destination_account.
The treasury_pda signs for this transfer using its seeds, proving that the program is authorizing the withdrawal.

### Account Structure
```rust
    #[account(
        seeds = [b"my-treasury", wsol_mint.key().as_ref()], 
        bump
    )]
    pub treasury_pda: InterfaceAccount<'info, TokenAccount>,
```

```rust
    #[derive(Accounts)]
pub struct InitializeTreasury<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    /// CHECK: ExtraAccountMetaList Account, must use these seeds
    #[account(
        mut,
        seeds = [b"my-treasury", mint.key().as_ref()], 
        bump
    )]
    pub treasury_pda: AccountInfo<'info>, // <-- Declaration for initialization
    pub mint: InterfaceAccount<'info, Mint>,
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
}
```

## Testing

### Test Coverage
test suite written using the Anchor framework, which uses Mocha and Chai for its testing structure and assertions. Its purpose is to simulate interactions with your smart contract in a local, controlled environment to verify that every part of it works as expected.
Tested actions are:
1. Create Mints: It creates a brand new Token-2022 mint (hookedTokenMint) that will be used for the taxed transfers. It also defines the feeTokenMint as the public key for Wrapped SOL.
2. Find PDAs: It uses PublicKey.findProgramAddressSync to calculate the addresses for the extra-account-metas PDA and the treasury PDA. This is done before they are created on-chain.
3. Create ATAs: It creates all the necessary Associated Token Accounts (ATAs) for the admin and recipient to hold the new hookedTokenMint and for the admin to hold the feeTokenMint (for the final withdrawal).
4. Mint Tokens: It mints a starting balance of the hookedTokenMint to the admin's ATA, so the admin has funds to use in the transfer test.

**Happy Path Tests:**
- **Initialize**:
1. Action: It calls the initializeExtraAccountMetaList and initializeTreasury methods on your program. This sends transactions to the local validator to create and initialize the two required PDAs.
2. Verification: After the instructions are executed, it fetches the treasuryPda account from the local chain. It then uses expect (from the Chai assertion library) to verify two critical things:
   - expect(treasuryAccount.owner.equals(admin.publicKey)).to.be.false;: It confirms the treasury account is not owned by the admin, but by the Token Program. This is correct, as it's a token account.
   - expect(treasuryAccount.mint.equals(feeTokenMint)).to.be.true;: It confirms the treasury account is for the correct mint (wSOL).

- **The Hooked Transfer**: Simulates a token transfer that should trigger the fee-taking hook and verifies that the balances change correctly.
1. Setup: It first records the starting balances of the admin's token account, the recipient's token account, and the treasury.
2. Action:
It builds a standard getTransferCheckedInstruction.
Crucially, it manually adds the extra accounts required by the transfer hook to the instruction's keys array. This is what tells the Solana runtime to invoke your hook program during the transfer.
It sends this modified instruction in a transaction.
3. Verification: After the transfer is confirmed, it fetches the final balances and makes three precise assertions:
   - It checks that the admin's balance has decreased by the TRANSFER_AMOUNT plus the calculated feeAmount.
   - It checks that the recipient's balance has increased by exactly the TRANSFER_AMOUNT.
   - It checks that the treasury's balance has increased by exactly the feeAmount.
- **Withdrawing Fees**: This final test ensures that the admin can successfully withdraw the fees that have been collected in the treasury.
1. Setup: It gets the current balance of the treasury (which we know contains fees from the previous test) and the admin's wSOL account.
2. Action: It calls the withdraw method on your program, telling it to withdraw the entire balance of the treasury to the admin's fee ATA.
3. Verification: It fetches the final balances and asserts two things:
   - The treasury's balance is now zero.
   - The admin's wSOL account balance has increased by the amount that was in the treasury.
     
**Unhappy Path Tests:**
- **Fails to withdraw from the treasury for a non-authority**: Ensures that only the designated authority (the admin) can withdraw funds from the fee treasury. It's a critical security check to prevent theft of funds.
1. It first ensures the treasury has funds by performing another transfer.
2. It creates a new, random keypair (randomUser).
3. It attempts to call the withdraw instruction, but it tries to sign the transaction with randomUser instead of the admin.
4. The test is wrapped in a try...catch block. It expects the transaction to fail.
5. The catch block verifies that the error is a "Signature verification failed" error, which is what Solana returns when an instruction requires a signature from an account (admin.publicKey) that wasn't provided by a signer in the transaction (randomUser).
6. If the transaction succeeds for any reason, expect.fail() is called, immediately failing the test.
- **Fails a transfer if the sender cannot cover the fee**: Verifies that the Token-2022 program correctly enforces the transfer hook. If a mint is configured with a hook, the program will not allow any transfers unless the required extra accounts for that hook are provided in the instruction.
1. It constructs a standard getTransferCheckedInstruction, just like in the successful transfer test.
2. However, it intentionally omits adding the extraMetasPda and hookProgram accounts to the instruction.
3. It then attempts to send this incomplete transaction.
4. The test expects this transaction to fail. The Solana runtime and Token-2022 program should see that the mint requires a hook but that the necessary accounts are missing.
5. The catch block asserts that the error message contains 0x40, which is the hexadecimal error code for IncorrectAccount in the Token-2022 program. This confirms the program is correctly blocking transfers that don't adhere to the hook's requirements.

### Running Tests
```bash
yarn install    # install dependencies
anchor test     # run tests
```

### Additional Notes for Evaluators

This was my first Solana dApp and the learning curve was steep! The biggest challenges were figuring out account ownership validation (kept getting unauthorized errors) and dealing with async transaction confirmations. PDAs were confusing at first but once they clicked, the deterministic addressing made everything much cleaner.
