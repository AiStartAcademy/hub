```mermaid
erDiagram

  "User" {
    String id "🗝️"
    String name "❓"
    String email 
    DateTime emailVerified "❓"
    String image "❓"
    String password "❓"
    String role 
    String roles 
    String timezone 
    String birthday "❓"
    Boolean isAvailableForCalls 
    String bio "❓"
    String attribution "❓"
    String stripeCustomerId "❓"
    DateTime marketingReleaseAt "❓"
    String rocketchatId "❓"
    String rocketchatUsername "❓"
    DateTime createdAt 
    DateTime updatedAt 
    Boolean isMentor 
    String profileVisibility 
    String slug "❓"
    String scheduleToken "❓"
    String bookingToken "❓"
    String headline "❓"
    String location "❓"
    String languages "❓"
    String socialLinks "❓"
    String expertiseTags "❓"
    }
  

  "UserConsent" {
    String id "🗝️"
    String docKey 
    String version 
    DateTime acceptedAt 
    String ip "❓"
    String userAgent "❓"
    String cohortId "❓"
    }
  

  "PortfolioItem" {
    String id "🗝️"
    String title 
    String url 
    String thumbnail "❓"
    String outcome "❓"
    Int order 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "ProfileVideo" {
    String id "🗝️"
    String title "❓"
    String url 
    Int order 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "Testimonial" {
    String id "🗝️"
    String quote 
    String authorName 
    String authorRole "❓"
    String authorAvatar "❓"
    String source 
    String reviewId "❓"
    Int order 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "Account" {
    String id "🗝️"
    String type 
    String provider 
    String providerAccountId 
    String refresh_token "❓"
    String access_token "❓"
    Int expires_at "❓"
    String token_type "❓"
    String scope "❓"
    String id_token "❓"
    String session_state "❓"
    }
  

  "Session" {
    String id "🗝️"
    String sessionToken 
    DateTime expires 
    }
  

  "VerificationToken" {
    String identifier 
    String token 
    DateTime expires 
    }
  

  "Cohort" {
    String id "🗝️"
    String title 
    String slug "❓"
    String description "❓"
    String cover "❓"
    String status 
    String deliveryMode 
    String location "❓"
    String zoomLink "❓"
    String zoomMeetingId "❓"
    DateTime startDate "❓"
    DateTime endDate "❓"
    String startTime "❓"
    String endTime "❓"
    String timezone 
    String tools "❓"
    Boolean certificate 
    Boolean leadMagnet 
    String leadMagnetCta "❓"
    String memberEventType "❓"
    String rocketchatGroupId "❓"
    String rocketchatChannelName "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "CohortMaterial" {
    String id "🗝️"
    String title 
    String type 
    String url 
    Int order 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "Group" {
    String id "🗝️"
    String name 
    Boolean inPerson 
    Float price 
    Int seats 
    Boolean allowOneOnOne 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "GroupMember" {
    String id "🗝️"
    DateTime createdAt 
    }
  

  "CohortSession" {
    String id "🗝️"
    String title 
    String description "❓"
    DateTime date 
    String startTime 
    String endTime 
    String timezone 
    String status 
    String meetingLink "❓"
    String recordingLink "❓"
    String zoomOccurrenceId "❓"
    Int order 
    String gcalEventId "❓"
    String gcalSyncError "❓"
    DateTime gcalSyncedAt "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "SessionSeries" {
    String id "🗝️"
    String title 
    String kind 
    String description "❓"
    String status 
    String zoomLink "❓"
    String zoomMeetingId "❓"
    String days 
    String startTime 
    String endTime 
    String timezone 
    DateTime startDate 
    DateTime endDate "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "SessionSeriesCohort" {
    DateTime createdAt 
    }
  

  "SeriesOccurrence" {
    String id "🗝️"
    String title 
    DateTime date 
    String startTime 
    String endTime 
    String timezone 
    String status 
    String meetingLink "❓"
    String recordingLink "❓"
    String zoomOccurrenceId "❓"
    String gcalEventId "❓"
    String gcalSyncError "❓"
    DateTime gcalSyncedAt "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "Resource" {
    String id "🗝️"
    String title 
    String type 
    String url 
    DateTime createdAt 
    }
  

  "CohortInstructor" {
    String id "🗝️"
    String status 
    DateTime invitedAt "❓"
    DateTime respondedAt "❓"
    String notes "❓"
    String responseToken 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "CohortSessionInstructorResponse" {
    String id "🗝️"
    String availability 
    String note "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "SessionAssignment" {
    String id "🗝️"
    String status 
    String note "❓"
    String adminNote "❓"
    DateTime proposedDate "❓"
    String proposedStartTime "❓"
    String proposedEndTime "❓"
    DateTime respondedAt "❓"
    DateTime confirmedAt "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "InstructorReminderSend" {
    String id "🗝️"
    String kind 
    String sessionId 
    String status 
    String error "❓"
    DateTime sentAt 
    }
  

  "InstructorOutreach" {
    String id "🗝️"
    String subject 
    String body 
    String status 
    DateTime approvedAt "❓"
    DateTime sentAt "❓"
    String createdBy "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "InstructorOutreachSend" {
    String id "🗝️"
    String status 
    String error "❓"
    DateTime sentAt 
    }
  

  "Enrollment" {
    String id "🗝️"
    String source 
    String status 
    String attribution "❓"
    String segment "❓"
    DateTime createdAt 
    }
  

  "Payment" {
    String id "🗝️"
    String buyerEmail "❓"
    String buyerName "❓"
    String attribution "❓"
    String segment "❓"
    String stripeSessionId "❓"
    String stripePaymentLinkId "❓"
    String stripePaymentIntentId "❓"
    Int amount 
    String currency 
    String status 
    DateTime expiresAt "❓"
    String checkoutUrl "❓"
    DateTime recoveredAt "❓"
    String couponCode "❓"
    DateTime accountSetupSentAt "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "Membership" {
    String id "🗝️"
    String buyerEmail "❓"
    String buyerName "❓"
    String attribution "❓"
    String segment "❓"
    String stripeSessionId 
    String stripeSubscriptionId "❓"
    String stripeCustomerId "❓"
    Int amount 
    String currency 
    String tier 
    String status 
    DateTime currentPeriodEnd "❓"
    DateTime expiresAt "❓"
    String checkoutUrl "❓"
    String couponCode "❓"
    DateTime accountSetupSentAt "❓"
    DateTime welcomeSentAt "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "Coupon" {
    String id "🗝️"
    String code 
    String kind 
    Int percentOff "❓"
    Int amountOff "❓"
    String appliesTo 
    String cohortId "❓"
    Int maxRedemptions "❓"
    DateTime expiresAt "❓"
    Boolean active 
    Int commissionPercent "❓"
    String stripeCouponId "❓"
    String stripePromotionCodeId "❓"
    String note "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "Redemption" {
    String id "🗝️"
    String buyerEmail 
    Int amountOff 
    Int commission "❓"
    String commissionStatus "❓"
    DateTime createdAt 
    }
  

  "Pod" {
    String id "🗝️"
    String name 
    String slug 
    String status 
    Int capacity 
    String rocketchatGroupId "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "PodMember" {
    String id "🗝️"
    String role 
    DateTime joinedAt 
    DateTime leftAt "❓"
    }
  

  "Milestone" {
    String id "🗝️"
    String key 
    String title 
    String description "❓"
    Int order 
    }
  

  "MilestoneAchievement" {
    String id "🗝️"
    DateTime achievedAt 
    String evidenceUrl "❓"
    String note "❓"
    String status 
    }
  

  "MemberEvent" {
    String id "🗝️"
    String type 
    String title 
    String description "❓"
    DateTime date 
    String startTime 
    String endTime 
    String timezone 
    String meetingLink "❓"
    String recordingLink "❓"
    String minTier 
    String status 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "MemberResource" {
    String id "🗝️"
    String title 
    String description "❓"
    String type 
    String url 
    String category "❓"
    String minTier 
    Int order 
    Boolean published 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "Program" {
    String id "🗝️"
    String name 
    String description "❓"
    String cover "❓"
    String status 
    Boolean locked 
    Int priceCents "❓"
    Boolean includesWeeklyCalls 
    String accessMode 
    String memberMinTier "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "ProgramMaterial" {
    String id "🗝️"
    String title 
    String type 
    String url 
    Int order 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "ProgramAccess" {
    String id "🗝️"
    DateTime createdAt 
    }
  

  "ProgramEnrollment" {
    String id "🗝️"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "Module" {
    String id "🗝️"
    String name 
    String description "❓"
    Int order 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "Lesson" {
    String id "🗝️"
    String name 
    Int duration 
    String type 
    String text "❓"
    String videoUrl "❓"
    String posterUrl "❓"
    String intro "❓"
    String timecodes "❓"
    String tags "❓"
    Int order 
    String audioUrl "❓"
    String captionsUrl "❓"
    String dataUrl "❓"
    String zoomFileId "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "LessonVideo" {
    String id "🗝️"
    String language 
    String videoUrl 
    Boolean isPrimary 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "Quiz" {
    String id "🗝️"
    String name "❓"
    Int maxAttempts "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "QuizItem" {
    String id "🗝️"
    String questionText 
    String type 
    Int order 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "QuizOption" {
    String id "🗝️"
    String text 
    Boolean isCorrect 
    Int order 
    }
  

  "QuizSubmission" {
    String id "🗝️"
    Int attemptNumber 
    Float totalScore "❓"
    String status 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "QuizAnswer" {
    String id "🗝️"
    String textAnswer "❓"
    Float points "❓"
    }
  

  "QuizSelectedOption" {

    }
  

  "Assessment" {
    String id "🗝️"
    String name 
    Int order 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "AssessmentItem" {
    String id "🗝️"
    String title "❓"
    String questionText 
    String type 
    Int order 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "AssessmentOption" {
    String id "🗝️"
    String text 
    Boolean isCorrect 
    Int order 
    }
  

  "AssessmentSubmission" {
    String id "🗝️"
    String status 
    Float totalScore "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "AssessmentAnswer" {
    String id "🗝️"
    String textAnswer "❓"
    Float points "❓"
    }
  

  "SelectedOption" {

    }
  

  "LessonProgress" {
    String id "🗝️"
    DateTime createdAt 
    }
  

  "CourseReview" {
    String id "🗝️"
    Int rating 
    String text "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "InstructorSlot" {
    String id "🗝️"
    DateTime date 
    String startTime 
    String endTime 
    String timezone 
    Boolean isBooked 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "OneOnOneBooking" {
    String id "🗝️"
    String status 
    String meetingLink "❓"
    String studentNote "❓"
    String instructorNote "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "MediaFolder" {
    String id "🗝️"
    String name 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "Media" {
    String id "🗝️"
    String name 
    String url 
    String type 
    Int size "❓"
    Boolean downloadable 
    String description "❓"
    String thumbnailUrl "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "OnboardingForm" {
    String id "🗝️"
    String slug 
    String title 
    String description "❓"
    String ghlFieldMapping "❓"
    String aiPrompt "❓"
    String defaultRedirectUrl "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "OnboardingStep" {
    String id "🗝️"
    String title 
    String slug "❓"
    Int order 
    }
  

  "OnboardingElement" {
    String id "🗝️"
    String type 
    String label 
    Boolean required 
    Int order 
    }
  

  "OnboardingOption" {
    String id "🗝️"
    String text 
    String tag 
    Int order 
    String redirectUrl "❓"
    }
  

  "OnboardingTagCohort" {
    String id "🗝️"
    String tag 
    String url "❓"
    }
  

  "OnboardingResponse" {
    String id "🗝️"
    String answers 
    String tagCounts 
    String status 
    String aiResult "❓"
    String attribution "❓"
    DateTime createdAt 
    }
  

  "DuplicateJob" {
    String id "🗝️"
    String type 
    String status 
    Int progress 
    String message "❓"
    String error "❓"
    String resultId "❓"
    String resultUrl "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "LearningPath" {
    String id "🗝️"
    String title 
    String description "❓"
    Int order 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "LearningPathItem" {
    String id "🗝️"
    Int order 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "mind_health_config" {
    Int id "🗝️"
    String currentDate 
    DateTime updatedAt 
    String updatedById "❓"
    }
  

  "Contact" {
    String id "🗝️"
    String email 
    String name 
    String phone "❓"
    String birthday "❓"
    String userId "❓"
    String linkSource "❓"
    String status 
    Boolean excludeFromPipeline 
    String source "❓"
    String attribution "❓"
    String tags "❓"
    String notes "❓"
    DateTime lastActivityAt "❓"
    String aiBrief "❓"
    DateTime aiBriefAt "❓"
    DateTime unsubscribedAt "❓"
    DateTime courseEmailOptOutAt "❓"
    String unsubscribeToken "❓"
    String publicToken "❓"
    DateTime cohortBannerDismissedAt "❓"
    DateTime phoneConsentAt "❓"
    DateTime smsMarketingConsentAt "❓"
    DateTime smsTransactionalConsentAt "❓"
    Boolean doNotCall 
    DateTime smsOptOutAt "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "CloserSlot" {
    String id "🗝️"
    DateTime startAt 
    DateTime endAt 
    String timezone 
    DateTime createdAt 
    }
  

  "LeadBooking" {
    String id "🗝️"
    String status 
    String zoomMeetingId "❓"
    String zoomJoinUrl "❓"
    String gcalEventId "❓"
    String gcalSyncError "❓"
    String cancelToken 
    String notes "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "ContactEvent" {
    String id "🗝️"
    String type 
    String onboardingResponseId "❓"
    String metadata 
    String token "❓"
    DateTime expiresAt "❓"
    String utmSource "❓"
    String utmMedium "❓"
    String utmCampaign "❓"
    String utmContent "❓"
    DateTime createdAt 
    }
  

  "VenueEvent" {
    String id "🗝️"
    String title 
    String slug 
    String type 
    String description "❓"
    String organizerName 
    String orgName "❓"
    String contactEmail 
    String contactPhone "❓"
    DateTime date 
    String startTime 
    String endTime 
    String timezone 
    Int expectedAttendees "❓"
    Int capacity "❓"
    String status 
    String dealType 
    String dealNote "❓"
    String adminNote "❓"
    Int quoteAmountCents "❓"
    String quoteNote "❓"
    Int rentalFeeCents "❓"
    Int rentalDepositCents "❓"
    String rentalPaymentLinkId "❓"
    String rentalPaymentUrl "❓"
    String rentalPaymentStatus "❓"
    String cover "❓"
    String externalRegistrationUrl "❓"
    Int ticketPriceCents "❓"
    String ticketPaymentLink "❓"
    DateTime endDate "❓"
    String subtitle "❓"
    String videoUrl "❓"
    String priceNote "❓"
    String gallery "❓"
    String agenda "❓"
    String hosts "❓"
    String pricingTiers "❓"
    String faq "❓"
    Boolean isOnline 
    String source 
    String gcalEventId "❓"
    String gcalSyncError "❓"
    DateTime gcalSyncedAt "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "VenueEventRegistration" {
    String id "🗝️"
    String name 
    String email 
    String phone "❓"
    String status 
    DateTime waiverAcceptedAt "❓"
    String waiverVersion "❓"
    String ip "❓"
    String userAgent "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "VenueAgreement" {
    String id "🗝️"
    String templateKey 
    String contentMd 
    String token 
    String status 
    String signerName "❓"
    String signerEmail "❓"
    String signerTitle "❓"
    String signatureText "❓"
    String signatureSvg "❓"
    DateTime signedAt "❓"
    DateTime aisaSignedAt "❓"
    String aisaSignerName "❓"
    String aisaSignerTitle "❓"
    String signerIp "❓"
    String userAgent "❓"
    DateTime sentAt "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "CertificateTemplate" {
    String id "🗝️"
    String name 
    String layout 
    String backgroundUrl "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "Certificate" {
    String id "🗝️"
    String pdfUrl "❓"
    String pngUrl "❓"
    DateTime issuedAt 
    DateTime notifiedAt "❓"
    Boolean isRevoked 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "ContentPage" {
    String id "🗝️"
    String type 
    String slug 
    String url 
    String status 
    String priority "❓"
    String funnelStage 
    String segment "❓"
    String primaryKeyword 
    String secondaryKeywords "❓"
    String metaTitle 
    String metaDescription 
    String h1 
    String sectionsPlan "❓"
    String schemaTypes 
    String template 
    Boolean indexable 
    String guardrails "❓"
    String answerBlock "❓"
    String bodyHtml "❓"
    String sections "❓"
    String faq "❓"
    String sources "❓"
    String videos "❓"
    String ctas "❓"
    String ogImageUrl "❓"
    String inlineImages "❓"
    Int wordCount "❓"
    String proofVariant "❓"
    String importBatchId "❓"
    String agentRunId "❓"
    String competitorNotes "❓"
    String reviewedById "❓"
    String authorName 
    DateTime createdAt 
    DateTime updatedAt 
    DateTime publishedAt "❓"
    }
  

  "ImportBatch" {
    String id "🗝️"
    String type 
    String source 
    Int rowCount 
    Int createdRows 
    Int skippedRows 
    String createdById "❓"
    DateTime createdAt 
    }
  

  "Agent" {
    String id "🗝️"
    String slug 
    String name 
    String description 
    String status 
    String triggerType 
    String schedule "❓"
    String serviceSlug "❓"
    Int maxDurationMin 
    String settings "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "AgentRun" {
    String id "🗝️"
    String status 
    String triggeredBy "❓"
    String serviceRunId "❓"
    String ciPipelineId "❓"
    Int itemsProduced 
    Float costUsd "❓"
    String logTail "❓"
    String error "❓"
    DateTime startedAt "❓"
    DateTime finishedAt "❓"
    DateTime createdAt 
    }
  

  "AiUsage" {
    String id "🗝️"
    String feature 
    String model 
    Int promptTokens 
    Int completionTokens 
    Float costUsd 
    DateTime createdAt 
    }
  

  "Secret" {
    String id "🗝️"
    String key 
    String category 
    String kind 
    String valueEncrypted "❓"
    String iv "❓"
    String authTag "❓"
    String valuePlain "❓"
    String last4 "❓"
    String description "❓"
    String updatedBy "❓"
    DateTime updatedAt 
    DateTime createdAt 
    }
  

  "SecretAudit" {
    String id "🗝️"
    String key 
    String action 
    String actorId "❓"
    DateTime createdAt 
    }
  

  "DripCampaign" {
    String id "🗝️"
    String slug 
    String name 
    String description "❓"
    String status 
    String trigger 
    String segment 
    Boolean autoEnroll 
    String exitOnStatuses 
    Int priority 
    String timezone 
    Int sendWindowStartHour 
    Int sendWindowEndHour 
    Boolean skipWeekends 
    String testEmail "❓"
    DateTime sentAt "❓"
    String audienceSnapshot "❓"
    String cohortId "❓"
    DateTime logisticsConfirmedAt "❓"
    String idempotencyKey "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "DripStep" {
    String id "🗝️"
    Int order 
    Int delayHours 
    String anchor 
    Int offsetMinutes 
    String channel 
    String subject 
    String body 
    String ctaLabel "❓"
    String ctaUrl "❓"
    String callAssistantId "❓"
    String callFirstMessage "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "DripEnrollment" {
    String id "🗝️"
    String cohortId 
    String status 
    Int lastStepOrder 
    DateTime nextRunAt "❓"
    DateTime enrolledAt 
    DateTime completedAt "❓"
    DateTime exitedAt "❓"
    String exitReason "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "DripSend" {
    String id "🗝️"
    String status 
    String error "❓"
    String subject "❓"
    DateTime sentAt 
    DateTime openedAt "❓"
    DateTime firstClickedAt "❓"
    }
  

  "ContactNote" {
    String id "🗝️"
    String body 
    String authorId "❓"
    String authorLabel 
    String kind 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "ContactCall" {
    String id "🗝️"
    String provider 
    String providerCallId "❓"
    String direction 
    String status 
    String outcome "❓"
    String endedReason "❓"
    Int durationSec "❓"
    String recordingUrl "❓"
    String transcript "❓"
    String summary "❓"
    String analysis "❓"
    String assistantId "❓"
    String phoneNumber "❓"
    String transferredTo "❓"
    String authorId "❓"
    String authorLabel "❓"
    DateTime startedAt "❓"
    DateTime endedAt "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "ContactMessage" {
    String id "🗝️"
    String provider 
    String providerSid "❓"
    String direction 
    String status 
    String body 
    String fromNumber 
    String toNumber 
    String error "❓"
    String authorId "❓"
    String authorLabel "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "EmailEvent" {
    String id "🗝️"
    String type 
    String url "❓"
    String subject "❓"
    String bodyHtml "❓"
    String userAgent "❓"
    String ipHash "❓"
    String source 
    String metadata "❓"
    DateTime createdAt 
    }
  
    "User" o{--}o "Cohort" : ""
    "UserConsent" }o--|| "User" : "user"
    "PortfolioItem" }o--|| "User" : "user"
    "ProfileVideo" }o--|| "User" : "user"
    "Testimonial" }o--|| "User" : "user"
    "Account" }o--|| "User" : "user"
    "Session" }o--|| "User" : "user"
    "Cohort" |o--|o "Program" : "rawProgram"
    "Cohort" o{--}o "Program" : ""
    "CohortMaterial" }o--|| "Cohort" : "cohort"
    "Group" }o--|| "Cohort" : "cohort"
    "GroupMember" }o--|| "Group" : "group"
    "GroupMember" }o--|| "User" : "user"
    "CohortSession" }o--|| "Cohort" : "cohort"
    "CohortSession" |o--|o "CohortSession" : "linkedSession"
    "CohortSession" }o--|o "User" : "instructor"
    "SessionSeries" }o--|o "User" : "instructor"
    "SessionSeriesCohort" }o--|| "SessionSeries" : "series"
    "SessionSeriesCohort" }o--|| "Cohort" : "cohort"
    "SeriesOccurrence" }o--|| "SessionSeries" : "series"
    "SeriesOccurrence" }o--|o "User" : "instructor"
    "Resource" }o--|| "CohortSession" : "session"
    "CohortInstructor" }o--|| "Cohort" : "cohort"
    "CohortInstructor" }o--|| "User" : "instructor"
    "CohortSessionInstructorResponse" }o--|| "CohortInstructor" : "cohortInstructor"
    "CohortSessionInstructorResponse" }o--|| "CohortSession" : "session"
    "SessionAssignment" }o--|| "CohortInstructor" : "cohortInstructor"
    "SessionAssignment" }o--|| "CohortSession" : "session"
    "InstructorReminderSend" }o--|| "CohortInstructor" : "cohortInstructor"
    "InstructorOutreach" }o--|| "Cohort" : "cohort"
    "InstructorOutreachSend" }o--|| "InstructorOutreach" : "outreach"
    "InstructorOutreachSend" }o--|| "CohortInstructor" : "cohortInstructor"
    "Enrollment" }o--|| "User" : "user"
    "Enrollment" }o--|| "Cohort" : "cohort"
    "Payment" }o--|o "User" : "user"
    "Payment" }o--|o "Cohort" : "cohort"
    "Payment" }o--|o "Group" : "group"
    "Payment" }o--|o "VenueEvent" : "venueEvent"
    "Payment" }o--|o "Program" : "program"
    "Membership" }o--|o "User" : "user"
    "Coupon" }o--|o "User" : "owner"
    "Redemption" }o--|| "Coupon" : "coupon"
    "Redemption" |o--|o "Payment" : "payment"
    "Redemption" |o--|o "Membership" : "membership"
    "Pod" }o--|o "User" : "coach"
    "Pod" }o--|o "Cohort" : "cohort"
    "PodMember" }o--|| "Pod" : "pod"
    "PodMember" }o--|| "User" : "user"
    "MilestoneAchievement" }o--|| "User" : "user"
    "MilestoneAchievement" }o--|| "Milestone" : "milestone"
    "MilestoneAchievement" }o--|o "User" : "verifiedBy"
    "MemberEvent" }o--|o "Pod" : "pod"
    "ProgramMaterial" }o--|| "Program" : "program"
    "ProgramAccess" }o--|| "Program" : "program"
    "ProgramAccess" }o--|| "User" : "user"
    "ProgramEnrollment" }o--|| "User" : "user"
    "ProgramEnrollment" }o--|| "Program" : "program"
    "Module" }o--|| "Program" : "program"
    "Lesson" }o--|| "Module" : "module"
    "LessonVideo" }o--|| "Lesson" : "lesson"
    "Quiz" |o--|| "Lesson" : "lesson"
    "QuizItem" }o--|| "Quiz" : "quiz"
    "QuizOption" }o--|| "QuizItem" : "item"
    "QuizSubmission" }o--|| "Quiz" : "quiz"
    "QuizSubmission" }o--|| "User" : "user"
    "QuizAnswer" }o--|| "QuizSubmission" : "submission"
    "QuizAnswer" }o--|| "QuizItem" : "item"
    "QuizSelectedOption" }o--|| "QuizAnswer" : "answer"
    "QuizSelectedOption" }o--|| "QuizOption" : "option"
    "Assessment" }o--|| "Module" : "module"
    "AssessmentItem" }o--|| "Assessment" : "assessment"
    "AssessmentOption" }o--|| "AssessmentItem" : "item"
    "AssessmentSubmission" }o--|| "Assessment" : "assessment"
    "AssessmentSubmission" }o--|| "User" : "user"
    "AssessmentSubmission" }o--|o "Cohort" : "cohort"
    "AssessmentAnswer" }o--|| "AssessmentSubmission" : "submission"
    "AssessmentAnswer" }o--|| "AssessmentItem" : "item"
    "SelectedOption" }o--|| "AssessmentAnswer" : "answer"
    "SelectedOption" }o--|| "AssessmentOption" : "option"
    "LessonProgress" }o--|| "User" : "user"
    "LessonProgress" }o--|| "Lesson" : "lesson"
    "LessonProgress" }o--|o "Cohort" : "cohort"
    "CourseReview" }o--|| "User" : "user"
    "CourseReview" }o--|| "Program" : "program"
    "InstructorSlot" }o--|| "Group" : "group"
    "InstructorSlot" }o--|| "User" : "instructor"
    "OneOnOneBooking" |o--|| "InstructorSlot" : "slot"
    "OneOnOneBooking" }o--|| "User" : "student"
    "OneOnOneBooking" }o--|| "User" : "instructor"
    "OneOnOneBooking" }o--|| "Group" : "group"
    "MediaFolder" |o--|o "MediaFolder" : "parent"
    "Media" }o--|o "MediaFolder" : "folder"
    "OnboardingForm" }o--|o "OnboardingElement" : "routingElement"
    "OnboardingStep" }o--|| "OnboardingForm" : "form"
    "OnboardingElement" }o--|| "OnboardingStep" : "step"
    "OnboardingOption" }o--|| "OnboardingElement" : "element"
    "OnboardingOption" }o--|o "OnboardingStep" : "nextStep"
    "OnboardingTagCohort" }o--|| "OnboardingForm" : "form"
    "OnboardingTagCohort" }o--|o "Cohort" : "cohort"
    "OnboardingResponse" }o--|| "OnboardingForm" : "form"
    "OnboardingResponse" }o--|o "Cohort" : "cohort"
    "LearningPath" }o--|| "Cohort" : "cohort"
    "LearningPathItem" }o--|| "LearningPath" : "learningPath"
    "LearningPathItem" }o--|| "Lesson" : "lesson"
    "CloserSlot" }o--|| "User" : "closer"
    "LeadBooking" |o--|| "CloserSlot" : "slot"
    "LeadBooking" }o--|| "Contact" : "contact"
    "ContactEvent" }o--|| "Contact" : "contact"
    "VenueEvent" }o--|o "Contact" : "contact"
    "VenueEventRegistration" }o--|| "VenueEvent" : "venueEvent"
    "VenueEventRegistration" }o--|o "Contact" : "contact"
    "VenueAgreement" }o--|| "VenueEvent" : "venueEvent"
    "Certificate" }o--|| "User" : "user"
    "Certificate" }o--|| "Cohort" : "cohort"
    "Certificate" }o--|| "CertificateTemplate" : "template"
    "AgentRun" }o--|| "Agent" : "agent"
    "DripStep" }o--|| "DripCampaign" : "campaign"
    "DripEnrollment" }o--|| "DripCampaign" : "campaign"
    "DripEnrollment" }o--|| "Contact" : "contact"
    "DripSend" }o--|| "DripEnrollment" : "enrollment"
    "DripSend" }o--|| "DripStep" : "step"
    "DripSend" }o--|o "Contact" : "contact"
    "ContactNote" }o--|| "Contact" : "contact"
    "ContactCall" }o--|| "Contact" : "contact"
    "ContactCall" |o--|o "DripSend" : "dripSend"
    "ContactMessage" }o--|| "Contact" : "contact"
    "ContactMessage" |o--|o "DripSend" : "dripSend"
    "EmailEvent" }o--|| "Contact" : "contact"
    "EmailEvent" }o--|o "DripSend" : "dripSend"
```
