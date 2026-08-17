<?php
if (!defined('ABSPATH')) exit;

function ai_log($message, $data = null) {
    $log_message = '[AI Order Creator - Groq] ' . $message;
    if ($data !== null) {
        $log_message .= ' | Data: ' . print_r($data, true);
    }
    error_log($log_message);
}
