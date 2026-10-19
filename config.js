
/* Public endpoint configuration only. Never place credentials or tokens here. */
window.JARVIS_CONFIG = {
  apiBaseUrl: "https://7qen6wleeb.execute-api.eu-west-2.amazonaws.com",
  endpoints: {
    status: {
      path: "/status",
      method: "POST"
    }
  }
};
