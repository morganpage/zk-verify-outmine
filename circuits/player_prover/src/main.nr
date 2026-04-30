// Player Prover Circuit (Noir)
//
// This circuit demonstrates server-side proof generation for individual player rewards.
// The server computes a player's reward using the game formula and generates a ZK proof
// that the calculation was correct. This proof is submitted to zkVerify, giving players
// cryptographic assurance the server applied the correct formula without having to trust it.
//
// PATTERN: Compute expected reward → assert it matches the claimed reward.
// Simple, fast, and generates one proof per player per game tick.
//
// Contrast with the client-side approach (score_prover.circom):
//   - Client-side: player generates proof on their device (Groth16/Circom)
//   - Server-side: server generates proof after computing results (UltraHonk/Noir)
//
// This circuit's private inputs (game config, multipliers) stay off-chain.
// Only the public inputs (run_id, player_id, rewards_earned, timestamp) appear on-chain.

fn main(
    // --- Public inputs (visible on-chain) ---
    run_id: pub Field,          // Unique identifier for the game tick / run
    player_id: pub Field,       // Hash of the player's identifier (SHA-256 truncated)
    rewards_earned: pub Field,  // The reward given to this player
    timestamp: pub Field,       // Unix timestamp of when this was processed

    // --- Private inputs (stay off-chain, not revealed) ---
    base_reward: Field,         // Base reward per unit per tick
    team_bonus: Field,          // Bonus percentage per additional unit (e.g. 20 = 20%)
    mode_multiplier: Field,     // Bonus mode multiplier (e.g. 150 = 1.5x for hard mode)
    unit_count: Field,          // Number of units (characters, pets, workers, etc.)
    boost_multiplier: Field,    // Active boost multiplier (percentage, e.g. 30 = +30%)
    item_multiplier: Field,     // Item bonus multiplier (percentage, e.g. 10 = +10%)
    game_mode: Field,           // 0 = normal, 1 = bonus mode (higher risk, higher reward)
    random_outcome: Field,      // 0 = success (full reward), 1 = failure
    has_bonus_trait: Field,     // 1 = player gets consolation reward on failure
) {
    let bg = base_reward as u64;
    let pc = unit_count as u64;
    let sb = team_bonus as u64;
    let dm = mode_multiplier as u64;
    let boost = boost_multiplier as u64;
    let item = item_multiplier as u64;
    let mode = game_mode as u64;
    let outcome = random_outcome as u64;
    let gp = has_bonus_trait as u64;
    let p: u64 = 100;

    // Step 1: Base reward × unit count × team synergy
    // Formula: base × units × (100 + (units - 1) × synergy) / 100
    // More units = more rewards, with synergy bonus for team composition
    let step1 = bg * pc * (p + (pc - 1) * sb) / p;

    // Step 2: Apply bonus mode multiplier (e.g. hard mode = 1.5x rewards)
    let step2 = if mode == 1 {
        step1 * dm / p
    } else {
        step1
    };

    // Step 3: Determine final reward based on outcome
    //   success (0): full reward with boost and item multipliers applied
    //   failure + bonus trait (1): 10% of potential (consolation reward)
    //   failure + no bonus trait: 0
    let expected: u64 = if outcome == 0 {
        step2 * (p + boost) * (p + item) / (p * p)
    } else if gp == 1 {
        let potential = step2 * (p + boost) * (p + item) / (p * p);
        potential / 10
    } else {
        0
    };

    // Assert the claimed reward matches what the formula produces
    assert(expected as Field == rewards_earned);
}
