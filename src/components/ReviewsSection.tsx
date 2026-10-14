"use client";

import { useState, useEffect, useCallback } from "react";
import { Trash2, Edit2, MessageCircle } from "lucide-react";
import Image from "next/image";
import { StarRating } from "./StarRating";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

interface Review {
  id: string;
  userId: string;
  rating: number;
  text: string | null;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    name: string | null;
    image: string | null;
    email: string;
  };
}

interface ReviewsData {
  reviews: Review[];
  averageRating: number;
  count: number;
}

interface ReviewsSectionProps {
  programId: string;
  currentUserId?: string;
}

export function ReviewsSection({
  programId,
  currentUserId,
}: ReviewsSectionProps) {
  const [reviewsData, setReviewsData] = useState<ReviewsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formRating, setFormRating] = useState(5);
  const [formText, setFormText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [canLeaveReview, setCanLeaveReview] = useState(false);

  const userReview = reviewsData?.reviews.find(
    (r) => r.userId === currentUserId
  );

  const fetchReviews = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/programs/${programId}/reviews`);
      const data = await response.json();
      setReviewsData(data);
    } catch (err) {
      setError("Failed to load reviews");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [programId]);

  const checkEligibility = useCallback(async () => {
    if (!currentUserId) {
      setCanLeaveReview(false);
      return;
    }

    try {
      // Try to submit - the API will return 403 if not eligible
      const response = await fetch(`/api/programs/${programId}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating: 5, text: "" }),
      });

      if (response.status === 403) {
        const data = await response.json();
        if (data.error?.includes("complete at least 90%")) {
          setCanLeaveReview(false);
          return;
        }
      }

      if (response.ok || response.status === 409) {
        setCanLeaveReview(true);
      }
    } catch (err) {
      console.error("Error checking eligibility:", err);
    }
  }, [currentUserId, programId]);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  useEffect(() => {
    if (userReview) {
      setFormRating(userReview.rating);
      setFormText(userReview.text || "");
    }
  }, [userReview]);

  useEffect(() => {
    if (currentUserId) {
      checkEligibility();
    }
  }, [currentUserId, checkEligibility]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!currentUserId) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const method = userReview ? "PUT" : "POST";
      const response = await fetch(`/api/programs/${programId}/reviews`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating: formRating,
          text: formText.trim() || null,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(
          data.error || "Failed to save review"
        );
      }

      await fetchReviews();
      setIsFormOpen(false);
      setFormText("");
      setFormRating(5);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Failed to save review"
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Are you sure you want to delete this review?")) return;

    try {
      const response = await fetch(`/api/programs/${programId}/reviews`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete review");
      }

      await fetchReviews();
      setIsFormOpen(false);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Failed to delete review"
      );
    }
  }

  if (loading) {
    return (
      <div className="py-8 text-center text-gray-500 dark:text-gray-400">
        Loading reviews...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2 text-gray-900 dark:text-gray-100">
              <MessageCircle className="w-6 h-6" />
              Course Reviews
            </h2>
            {reviewsData && reviewsData.count > 0 && (
              <div className="flex items-center gap-4 mt-2">
                <div className="flex items-center gap-2">
                  <StarRating value={Math.round(reviewsData.averageRating)} readonly />
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {reviewsData.averageRating.toFixed(1)} ({reviewsData.count} {reviewsData.count === 1 ? "review" : "reviews"})
                  </span>
                </div>
              </div>
            )}
          </div>

          {currentUserId && canLeaveReview && !userReview && (
            <button
              onClick={() => setIsFormOpen(!isFormOpen)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Leave a Review
            </button>
          )}
        </div>

        {/* Review Form */}
        {currentUserId && canLeaveReview && isFormOpen && (
          <form onSubmit={handleSubmit} className="bg-gray-50 dark:bg-gray-900 p-6 rounded-lg mb-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Rating
              </label>
              <StarRating
                value={formRating}
                onChange={setFormRating}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Review (optional)
              </label>
              <textarea
                value={formText}
                onChange={(e) => setFormText(e.target.value)}
                placeholder="Share your thoughts about this course..."
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 resize-none"
                rows={4}
              />
            </div>

            {submitError && (
              <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded">
                {submitError}
              </div>
            )}

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => {
                  setIsFormOpen(false);
                  setFormText("");
                  setFormRating(5);
                  setSubmitError(null);
                }}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
              >
                {isSubmitting ? "Saving..." : "Save Review"}
              </button>
            </div>

            {userReview && (
              <button
                type="button"
                onClick={() => handleDelete()}
                className="w-full px-3 py-2 text-red-600 border border-red-300 rounded-lg hover:bg-red-50 transition-colors flex items-center justify-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                Delete Review
              </button>
            )}
          </form>
        )}

        {/* Call to Action */}
        {currentUserId && !canLeaveReview && !userReview && (
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-4 rounded-lg text-sm text-blue-800 dark:text-blue-300 mb-6">
            Complete at least 90% of the course to leave a review.
          </div>
        )}

        {!currentUserId && (
          <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-4 rounded-lg text-sm text-gray-600 dark:text-gray-400 mb-6">
            Sign in to leave a review.
          </div>
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 rounded-lg text-sm text-red-800 dark:text-red-300 mb-6">
            {error}
          </div>
        )}
      </div>

      {/* Reviews List */}
      <div className="space-y-4">
        {reviewsData && reviewsData.count === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            No reviews yet. Be the first to leave a review!
          </div>
        ) : (
          reviewsData?.reviews.map((review) => (
            <div
              key={review.id}
              className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3 bg-white dark:bg-gray-800"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  {review.user.image && (
                    <Image
                      src={review.user.image}
                      alt={review.user.name || "User"}
                      width={40}
                      height={40}
                      className="rounded-full"
                    />
                  )}
                  <div>
                    <p className="font-medium text-gray-900 dark:text-gray-100">
                      {review.user.name || "Anonymous"}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {formatDistanceToNow(new Date(review.createdAt), {
                        addSuffix: true,
                        locale: ru,
                      })}
                    </p>
                  </div>
                </div>

                {currentUserId === review.userId && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setIsFormOpen(true)}
                      className="p-1.5 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                      title="Edit review"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              <StarRating value={review.rating} readonly size="sm" />

              {review.text && (
                <p className="text-gray-700 dark:text-gray-300 text-sm">{review.text}</p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
