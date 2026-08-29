/**
 * Naval Ravikant Quotes
 *
 * Curated wisdom for daily inspiration.
 * Rotates based on day of year.
 */

const NAVAL_QUOTES = [
  "Desire is a contract you make with yourself to be unhappy until you get what you want.",
  "The secret to doing good research is always to be a little underemployed.",
  "Learn to sell. Learn to build. If you can do both, you will be unstoppable.",
  "Specific knowledge is found by pursuing your genuine curiosity.",
  "Play long-term games with long-term people.",
  "All the returns in life come from compound interest.",
  "Reading is faster than listening. Doing is faster than watching.",
  "Code and media are permissionless leverage. They're the leverage behind the newly rich.",
  "Forty hour work weeks are a relic of the Industrial Age.",
  "If you can't see yourself working with someone for life, don't work with them for a day.",
  "Earn with your mind, not your time.",
  "You're not going to get rich renting out your time.",
  "Retirement is when you stop sacrificing today for an imaginary tomorrow.",
  "The most important skill for getting rich is becoming a perpetual learner.",
  "Escape competition through authenticity.",
  "No one can compete with you on being you.",
  "The internet has massively broadened the possible space of careers.",
  "Think clearly from the ground up. Understand something from first principles.",
  "A fit body, a calm mind, a house full of love. These things cannot be bought.",
  "Happiness is a choice and a skill.",
  "The hard thing is seeing the truth. Once you see it, the actions are obvious.",
  "If you want to be wealthy, spend time learning.",
  "Status games are always zero-sum. Wealth games can be positive-sum.",
  "My number one priority in life is my own physical and mental health.",
  "The direction you're heading matters more than how fast you're going.",
  "Free education is abundant, all over the internet. It's the desire to learn that's scarce.",
  "Pick an industry where you can play long-term games with long-term people.",
  "Wisdom is knowing the long-term consequences of your actions.",
  "The most dangerous things are heroin and a monthly salary.",
  "You make your own luck if you stay at it long enough.",
  "Self-improvement is just the title of the game.",
  "A rational person can find peace by cultivating indifference to things outside their control.",
  "The modern mind is overstimulated. The modern body is understimulated.",
  "Real knowledge is intrinsic, and it's built from the ground up.",
  "If you're desensitized to everything, nothing really matters anymore.",
  "The best founders I've seen are ones who are very long-term thinkers.",
  "What you do on a daily basis is what matters.",
  "Peace is happiness at rest. Happiness is peace in motion.",
  "A busy mind accelerates the perceived passage of time.",
  "Tension is who you think you should be. Relaxation is who you are.",
  "Before you can lie to another, you must first lie to yourself.",
  "If you diet, invest, and think according to what the news tells you, you'll end up nutritionally, financially, and morally bankrupt.",
  "Doctors won't make you healthy. Nutritionists won't make you slim. Teachers won't make you smart. Only you can do that.",
  "Value your time at an hourly rate, and ruthlessly spend to save time.",
  "Hard work is really overrated. How hard you work matters less in the modern economy.",
  "What's considered hard work is actually just busy work.",
  "Productize yourself. Figure out what you're uniquely good at and apply leverage.",
  "The three big ones in life are wealth, health, and happiness.",
  "Anger is a hot coal you hold in your hand while waiting to throw it at somebody else.",
  "Suffering is the moment when you see things exactly as they are.",
  "When you combine things you're curious about, you often find yourself at the cutting edge.",
  "If you have nothing in your life that's worth dying for, you have nothing worth living for.",
  "Creativity starts with empty space and a long time horizon.",
  "The real winners are the ones who step out of the game entirely.",
  "Don't spend your time making other people happy. Other people being happy is their problem.",
  "Success is the enemy of learning.",
  "Cynicism is easy. Mimicry is easy. Optimistic contrarians are the rarest breed.",
  "The best way to become a billionaire is to help a billion people.",
  "Impatience with actions, patience with results.",
  "The power to make and break habits is the definition of free will.",
  "All greatness comes from suffering. You have to suffer to be great.",
  "Sophisticated foods are bribed. Stick to basics.",
  "A calm mind, a fit body, a house full of love - things money can't buy.",
];

/**
 * Get today's quote based on day of year
 */
export function getDailyQuote(date: Date = new Date()): string {
  const startOfYear = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - startOfYear.getTime();
  const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));
  return NAVAL_QUOTES[dayOfYear % NAVAL_QUOTES.length];
}
