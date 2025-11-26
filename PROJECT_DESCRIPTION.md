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
Comprehensive test suite covering all instructions with both successful operations and error conditions to ensure program security and reliability.

**Happy Path Tests:**
- **Initialize Counter**: Successfully creates a new counter account with correct initial values
- **Increment Counter**: Properly increases count and total_increments by 1
- **Reset Counter**: Sets count to 0 while preserving owner and total_increments

**Unhappy Path Tests:**
- **Initialize Duplicate**: Fails when trying to initialize a counter that already exists
- **Increment Unauthorized**: Fails when non-owner tries to increment someone else's counter
- **Reset Unauthorized**: Fails when non-owner tries to reset someone else's counter
- **Account Not Found**: Fails when trying to operate on non-existent counter

### Running Tests
```bash
yarn install    # install dependencies
anchor test     # run tests
```

### Additional Notes for Evaluators

This was my first Solana dApp and the learning curve was steep! The biggest challenges were figuring out account ownership validation (kept getting unauthorized errors) and dealing with async transaction confirmations. PDAs were confusing at first but once they clicked, the deterministic addressing made everything much cleaner.
