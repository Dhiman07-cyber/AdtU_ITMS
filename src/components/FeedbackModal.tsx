"use client";

import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/contexts/toast-context';
import { Loader2,Mail,MessageSquare,Send,Sparkles,User } from 'lucide-react';
import { useState } from 'react';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function FeedbackModal({ isOpen, onClose }: FeedbackModalProps) {
  const { currentUser, userData } = useAuth();
  const { addToast } = useToast();
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!currentUser) {
      addToast('Please sign in to submit feedback', 'error');
      return;
    }

    const trimmedMessage = message.trim();

    if (trimmedMessage.length < 10) {
      addToast('Please enter at least 10 characters.', 'error');
      return;
    }

    setSubmitting(true);

    try {
      const token = await currentUser.getIdToken();

      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          idToken: token,
          message: trimmedMessage
        })
      });

      const result = await response.json();

      if (response.ok) {
        setMessage('');
        onClose();
        // Show success toast after modal closes
        setTimeout(() => {
          addToast('🎉 We have received your feedback! Thank you for helping us improve.', 'success');
        }, 100);
      } else {
        addToast(result.error || 'Failed to submit feedback', 'error');
      }
    } catch (error) {
      console.error('Error submitting feedback:', error);
      addToast('Network error. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit(e as any);
    }
  };

  const characterCount = message.length;
  const minChars = 10;
  const maxChars = 2000;
  const isValidLength = characterCount >= minChars && characterCount <= maxChars;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px] p-0 overflow-hidden bg-[#0f1219] border-gray-800 rounded-2xl shadow-2xl md:mt-5">
        {/* Header with Gradient */}
        <div className="relative px-6 pt-6 pb-4 bg-gradient-to-br from-indigo-600/20 via-purple-600/10 to-transparent">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />

          <DialogHeader className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
                <MessageSquare className="h-5 w-5 text-white" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
                  Send Feedback
                  <Sparkles className="h-4 w-4 text-amber-400" />
                </DialogTitle>
                <DialogDescription className="text-xs text-gray-400 mt-0.5">
                  Share your thoughts, suggestions, or report issues
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        {/* Form Content */}
        <form onSubmit={handleSubmit} className="px-6 py-5 md:space-y-1 sm:space-y-5">
          {/* Name Field */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-400 flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" />
              Your Name
            </label>
            <Input
              value={userData?.fullName || userData?.name || ''}
              readOnly
              disabled
              className="h-9 sm:h-10 bg-gray-800/50 border-gray-700/50 text-gray-400 text-sm cursor-not-allowed"
            />
          </div>

          {/* Email Field */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-400 flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" />
              Email Address
            </label>
            <Input
              value={userData?.email || ''}
              readOnly
              disabled
              className="h-9 sm:h-10 bg-gray-800/50 border-gray-700/50 text-gray-400 text-sm cursor-not-allowed"
            />
          </div>

          {/* Message Field */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-400 flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" />
              Your Message
              <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Tell us what's on your mind... We value every piece of feedback!"
                rows={5}
                maxLength={maxChars}
                className="bg-gray-800/50 min-h-[100px] max-h-[150px] border-gray-700 text-white placeholder:text-gray-500 resize-none text-sm leading-relaxed focus:border-indigo-500/50 focus:ring-indigo-500/20 transition-all"
                required
              />
              {/* Character Counter */}
              <div className="absolute bottom-2 right-3 flex items-center gap-2">
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${characterCount === 0
                  ? 'bg-gray-800 text-gray-500'
                  : characterCount < minChars
                    ? 'bg-amber-500/20 text-amber-400'
                    : characterCount > maxChars * 0.9
                      ? 'bg-red-500/20 text-red-400'
                      : 'bg-emerald-500/20 text-emerald-400'
                  }`}>
                  {characterCount}/{maxChars}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-gray-500">
                {characterCount < minChars && characterCount > 0 && (
                  <span className="text-amber-400">Need {minChars - characterCount} more characters</span>
                )}
                {characterCount === 0 && "Minimum 10 characters"}
                {characterCount >= minChars && "✓ Ready to submit"}
              </p>
              <p className="text-[10px] text-gray-600 mb-5">
                Press <kbd className="px-1.5 py-0.5 bg-gray-800 rounded text-gray-400 font-mono">Ctrl</kbd>+<kbd className="px-1.5 py-0.5 bg-gray-800 rounded text-gray-400 font-mono">Enter</kbd> to send
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 h-10 sm:h-11 bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700 hover:text-white text-sm font-medium transition-all"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting || !isValidLength}
              className="flex-1 h-11 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-medium text-sm transition-all shadow-lg shadow-indigo-500/25 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Send className="h-4 w-4" />
                  Submit Feedback
                </span>
              )}
            </Button>
          </div>
        </form>

        {/* Footer Note */}
        <div className="px-6 py-3 bg-gray-900/50 border-t border-gray-800/50">
          <p className="text-[10px] text-gray-500 text-center">
            💡 Your feedback helps us improve the bus service experience for everyone
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
