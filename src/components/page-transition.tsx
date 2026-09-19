"use client";

import { motion } from "motion/react";

export const PageTransition = ({ children }: { children: React.ReactNode }) => {
    return (
        <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{
                duration: 0.18,
                ease: [0.23, 1, 0.32, 1]
            }}
            className="w-full h-full"
        >
            {children}
        </motion.div>
    );
};
