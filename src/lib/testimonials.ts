import {
  content,
  type ContentTestimonial,
} from "@/config/content";

export type Testimonial = ContentTestimonial;

export const testimonials: readonly Testimonial[] = content.testimonials;
export const featuredTestimonials = testimonials.filter((testimonial) => testimonial.featured);
export const videoWallTestimonials = testimonials.filter((testimonial) => !testimonial.featured);
