# Tower Mobile App - Key Findings Summary

> Research conducted: January 2026
> Decision: **GO** (Bootstrap approach)

---

## 1. Market Opportunity

| Metric | Value | Source |
|--------|-------|--------|
| ADHD Apps Market (2026) | **$2.78 Billion** | Industry Research |
| CAGR Growth Rate | **15.6%** | Data Insights Market |
| US Market Size (2025) | **$773 Million** | Industry Research |
| Projected Market (2035) | **$11.9 Billion** | Industry Research |

### Market Drivers
- Rising ADHD diagnosis rates, especially in adults
- 48% of new ADHD apps use AI-powered personalization (mid-2024)
- Neurotypical productivity apps don't serve ADHD brains well
- Remote work increased demand for attention management tools

### Regional Breakdown
- North America: 39% market share
- Europe: 27%
- Asia-Pacific: 23% (fastest growing)
- Middle East & Africa: 11%

---

## 2. Competitor Analysis

| App | Focus | Pricing | AI Features | Threat |
|-----|-------|---------|-------------|--------|
| **Inflow** | ADHD coaching & CBT | $48/mo or $200/yr | Basic | Medium |
| **Todoist** | General task management | Free / $4/mo | AI prioritization | High |
| **Structured** | Time blocking | Free (iOS only) | None | Low |
| **Forest** | Focus gamification | $4 one-time | None | Low |
| **Freedom** | App/site blocking | $7/mo | None | Low |

### Tower's Differentiation
1. **Attention steering** vs task management (unique positioning)
2. **AI natural language capture** with brain dump support
3. **isEvent model** distinguishes actions from appointments
4. **Minimal UI** that doesn't overwhelm ADHD brains
5. **2-minute timer** for activation energy battles

---

## 3. Development Costs

### React Native (Recommended)

| Approach | Cost | Timeline | Risk |
|----------|------|----------|------|
| **You + Claude Code (DIY)** | **$0 - $500** | 4-8 weeks | Medium |
| Freelancer (India/Asia) | $5,000 - $15,000 | 4-6 weeks | Medium |
| Freelancer (US/EU) | $15,000 - $40,000 | 4-6 weeks | Low |
| Agency | $50,000 - $100,000 | 8-12 weeks | Low |

### Why React Native?
- 90% code reuse between iOS and Android
- Your existing React/TypeScript skills transfer directly
- Supabase SDK works identically on mobile
- Expo simplifies build/deploy pipeline
- Large community, abundant resources for Claude Code assistance

### Alternative Frameworks
- **Flutter**: $10K-$120K, requires learning Dart (not recommended)
- **Native iOS + Android**: $60K-$160K, 2x cost (not recommended for MVP)

---

## 4. Ongoing Costs

### Platform Fees
| Item | Cost |
|------|------|
| Apple Developer Program | $99/year |
| Google Play (one-time) | $25 |
| Apple Commission (< $1M revenue) | 15% |
| Google Commission (< $1M revenue) | 15% |
| Subscription commission (Year 2+) | 15% (both) |

### Backend (Supabase)
| Item | Cost |
|------|------|
| Pro Plan | $25/month |
| Included MAUs | 100,000 |
| Overage per MAU | $0.00325 |

### AI API Costs (Claude)

| Model | Price (per million tokens) | Use Case |
|-------|---------------------------|----------|
| Haiku 3.5 | $0.80 input / $4 output | Task parsing (recommended) |
| Haiku 4.5 | $1 input / $5 output | Enhanced parsing |
| Sonnet | $3 input / $15 output | Complex insights |
| Opus 4.5 | $5 input / $25 output | Premium features |

**Estimated cost per user**: $0.05 - $0.50/month (using Haiku for parsing)

---

## 5. Monetization Strategy

### Recommended: Hybrid Model

| Tier | Price | Features |
|------|-------|----------|
| Free | $0 | Basic Tower, 5 AI calls/day, manual entry |
| Pro | $6.99/mo | Unlimited AI (you pay), all features |
| Pro BYOK | $2.99/mo | All features, user provides API key |

### Why Hybrid?
- Free tier demonstrates value (limit prevents abuse)
- Pro tier is simple for most users
- BYOK tier captures technical users who want control
- BYOK users still pay (you provide value beyond API)

### Pricing Context
- Inflow: $48/month (8x your price)
- Todoist Pro: $4/month (similar)
- Your $6.99 is competitive and covers AI costs

---

## 6. User Acquisition & Marketing

### CAC Reality Check
- **Productivity apps average**: $80-160 CAC
- **Target (organic/viral)**: $10-30 CAC

### Low-Cost Channels

| Channel | Cost | Expected CAC |
|---------|------|--------------|
| ADHD Reddit/Communities | $0 | $0-5 |
| TikTok/Reels (ADHD content) | $0 | $5-15 |
| ASO (App Store Optimization) | $0-500 | $10-20 |
| ProductHunt Launch | $0 | $5-10 |
| ADHD Blogger/YouTuber Reviews | $0-500 | $15-30 |
| Apple Search Ads | $$ | $50-100+ |
| Facebook/Instagram Ads | $$$ | $80-150+ |

### ADHD Community Strategy (Recommended)
- **r/ADHD** (1.7M members) - share your journey building for yourself
- **ADHD TikTok** - short demos of the "brain dump to structured items" flow
- **ADHD Twitter/X** - connect with ADHD coaches, therapists
- **Podcast interviews** - How I Organize, ADHD-focused shows

**Key insight**: Don't market. Share your story of building a tool for your own ADHD brain. Authenticity converts.

---

## 7. Risk Analysis

### Platform Risk: Apple "Sherlocking"
**Risk Level: Medium-Low**

Apple's Focus Modes are generic. ADHD-specific features (brain dump parsing, attention steering, 2-min timer psychology) are too niche for Apple to build.

**Mitigation**: Differentiate on ADHD-specific psychology, not just features.

### AI Cost Escalation
**Risk Level: Medium**

Heavy users could cost more in API fees than they pay in subscription.

**Mitigation**: Use Haiku for parsing (cheapest), implement rate limits on free tier, offer BYOK for power users.

### Competition from Inflow/Todoist
**Risk Level: Medium**

Established players have more resources and users.

**Mitigation**: Focus on "attention steering" positioning (unique), not general task management.

### Low Retention
**Risk Level: Medium**

Productivity apps have notoriously low retention. ADHD users may try and abandon.

**Mitigation**: Design for ADHD brains specifically (less overwhelming, trust the algorithm).

### App Store Rejection
**Risk Level: Low**

Tower doesn't violate any obvious guidelines. Apps with AI features are common. No medical claims = no regulatory issues.

---

## 8. Scenario Analysis

### Scenario A: Bootstrap (RECOMMENDED)
| Item | Value |
|------|-------|
| Development | $0-500 (you + Claude Code) |
| Timeline | 4-8 weeks |
| Year 1 Costs | ~$2,000 |
| Break-even | ~25 paid subscribers |
| Risk if fails | ~$2,000 + your time |

**Verdict: GO**

### Scenario B: Freelancer
| Item | Value |
|------|-------|
| Development | $10,000-25,000 |
| Year 1 Costs | ~$12,000-27,000 |
| Break-even | ~200-400 subscribers |

**Verdict: CAUTION** - Validate demand first

### Scenario C: Agency + Marketing
| Item | Value |
|------|-------|
| Development | $50,000-100,000 |
| Marketing | $20,000-50,000 |
| Year 1 Costs | $75,000-155,000 |
| Break-even | ~1,500-3,000 subscribers |

**Verdict: NO-GO** - Too much risk for unvalidated market

---

## 9. Final Recommendation

### Decision: BUILD IT YOURSELF

Use React Native + Expo. Port your existing code with Claude Code assistance. Target 4-8 weeks of evenings/weekends. Launch at $6.99/month. The ADHD market is real, your product is differentiated, and your risk is minimal.

### Action Plan

1. **Week 1-2**: Set up React Native/Expo project, port UI components
2. **Week 3-4**: Integrate Supabase, port authentication
3. **Week 5-6**: Port Tower view, AI capture, test on both platforms
4. **Week 7**: Polish, App Store assets, beta test with 5-10 ADHD users
5. **Week 8**: Submit to App Store & Play Store
6. **Post-launch**: Share journey on r/ADHD, ADHD Twitter, iterate based on feedback

### Success Metrics

| Metric | Month 3 Target | Month 12 Target |
|--------|----------------|-----------------|
| Downloads | 500 | 5,000 |
| Free → Paid Conversion | 5% | 8% |
| Paid Subscribers | 25 | 400 |
| MRR | $175 | $2,800 |
| Day 7 Retention | 30% | 40% |

---

## 10. Sources

### Market Research
- [Industry Research - ADHD Apps Market](https://www.industryresearch.co/market-reports/adhd-apps-market-300618)
- [Data Insights Market - ADHD Apps Report](https://www.datainsightsmarket.com/reports/adhd-apps-528471)
- [Fluidwave - Productivity Apps for ADHD](https://fluidwave.com/blog/productivity-apps-for-adhd)

### Development Costs
- [Medium - React Native App Development Cost 2025](https://medium.com/front-end-weekly/how-much-does-it-cost-to-develop-a-react-native-app-in-2025-real-world-examples-included-ef992e2308a9)
- [ReactSquad - Cost to Hire React Native Developers](https://www.reactsquad.io/blog/cost-to-hire-react-native-developers)

### Platform Fees
- [SplitMetrics - Google Play and App Store Fees](https://splitmetrics.com/blog/google-play-apple-app-store-fees/)
- [SharpSheets - Apple & Google Mobile App Fees](https://sharpsheets.io/blog/app-store-and-google-play-commissions-fees/)

### AI Pricing
- [Claude Pricing Documentation](https://platform.claude.com/docs/en/about-claude/pricing)
- [Finout - Anthropic API Pricing Guide](https://www.finout.io/blog/anthropic-api-pricing)

### User Acquisition
- [Survicate - App User Acquisition Cost Guide 2025](https://survicate.com/blog/app-user-acquisition-cost/)
- [Mapendo - App User Acquisition Cost 2025](https://mapendo.co/blog/app-user-acquisition-cost-2025)

### Backend
- [Supabase Pricing](https://supabase.com/pricing)
- [UI Bakery - Supabase Pricing 2025](https://uibakery.io/blog/supabase-pricing)

### Monetization
- [RevenueCat - App Monetization Trends 2025](https://www.revenuecat.com/blog/growth/2025-app-monetization-trends/)
- [JetBrains - BYOK Implementation](https://blog.jetbrains.com/ai/2025/12/bring-your-own-key-byok-is-now-live-in-jetbrains-ides/)

### Competitor Research
- [Choosing Therapy - Inflow ADHD App Review](https://www.choosingtherapy.com/inflow-adhd-app-review/)
- [iGeeksBlog - Best ADHD Apps for iPhone](https://www.igeeksblog.com/best-adhd-apps-for-iphone/)
